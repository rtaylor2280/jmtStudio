// JMT Studio Driver Helper. [B-681]
//
// The two jobs JMT Studio needs administrator rights for, as one small signed program, so Studio
// never starts a hidden elevated PowerShell (the pattern antivirus behaviour engines convict):
//
//   dfu-driver --inf <path> --result <path>
//       Puts JMT Studio's signed WinUSB package in the driver store if it is not there yet, then
//       binds every connected STM32 bootloader (USB\VID_0483&PID_DF11) to it. The bind is forced
//       because ST's WHQL STTub30 driver outranks WinUSB for a new device node.
//
//   webusb --serial <12 hex digits> --result <path>
//       Repairs Windows' saved WebUSB setting for one Proffieboard [B-660]. Windows reads a USB
//       function's extra properties once and then never asks again, so a build without WebUSB can
//       leave interface 2 with no DeviceInterfaceGUIDs for every later WebUSB build. The repair
//       removes Windows' saved node for interface 2 and the board's descriptor cache, then
//       rescans; Windows rebuilds the node and reads the GUID fresh. The serial port is not
//       touched and no replug is needed.
//
// Studio starts this elevated (the Windows administrator prompt, publisher shown) and waits for
// the result file, which is written as the very last action: { "status": ..., "detail": ... },
// UTF-8 without a byte order mark. Exit codes match the PowerShell scripts this replaces.
//
// Built by scripts/build-driver-helper.js with the C# compiler that ships with Windows
// (.NET Framework 4), so it needs nothing installed on the build machine or the user's.

using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

// The version resource. Windows' administrator prompt shows the title as the program's name.
[assembly: AssemblyTitle("JMT Studio Driver Helper")]
[assembly: AssemblyDescription("Installs the Proffieboard bootloader driver and repairs WebUSB for JMT Studio")]
[assembly: AssemblyCompany("JMT Sabers")]
[assembly: AssemblyProduct("JMT Studio")]
[assembly: AssemblyCopyright("Copyright 2026 Ryan Taylor")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class DriverHelper
{
    const string DFU_HWID = "USB\\VID_0483&PID_DF11";
    const string PACKAGE_CAT = "jmt_proffie_winusb.cat";

    static string _log = Path.Combine(Path.GetTempPath(), "jmt-driver-helper.log");

    static void Log(string m)
    {
        try { File.AppendAllText(_log, "[" + DateTime.Now.ToString("o") + "] " + m + Environment.NewLine); }
        catch { }
    }

    static int Main(string[] args)
    {
        var a = ParseArgs(args);
        string resultPath = Arg(a, "result");
        try
        {
            string cmd = args.Length > 0 ? args[0] : "";
            Log("start: " + string.Join(" ", args));
            if (cmd == "dfu-driver") return DfuDriver(Arg(a, "inf"), resultPath);
            if (cmd == "webusb") return WebUsb(Arg(a, "serial"), resultPath);
            WriteResult(resultPath, "error", "Unknown command: " + cmd);
            return 2;
        }
        catch (Exception e)
        {
            Log("failed: " + e);
            WriteResult(resultPath, "error", e.Message);
            return 1;
        }
    }

    // ── dfu-driver ──

    static int DfuDriver(string inf, string resultPath)
    {
        if (string.IsNullOrEmpty(inf) || !File.Exists(inf))
        {
            WriteResult(resultPath, "error", "Driver INF not found: " + inf);
            return 2;
        }

        // 1) Into the driver store, only if it is not there yet, so the Windows "install this
        // device software" prompt appears at most once per machine.
        bool already = PackageStaged();
        Log("already staged: " + already);
        if (!already)
        {
            bool reboot;
            // DiInstallDriver's result is not the verdict: it reports failure when a higher-ranked
            // driver kept the package from binding, although the package staged fine. Whether the
            // package reached the store is the verdict; it does not when the prompt was declined.
            bool ok = NativeMethods.DiInstallDriverW(IntPtr.Zero, inf, 0, out reboot);
            int err = Marshal.GetLastWin32Error();
            Log("DiInstallDriver ok=" + ok + " err=" + err);
            if (!PackageStaged())
            {
                WriteResult(resultPath, "error", "Driver install was not completed (the Windows install prompt may have been declined). Error " + err + ".");
                return 3;
            }
        }

        // 2) Force-bind every connected bootloader to this package.
        bool reboot2;
        bool bound = NativeMethods.UpdateDriverForPlugAndPlayDevicesW(IntPtr.Zero, DFU_HWID, inf, NativeMethods.INSTALLFLAG_FORCE, out reboot2);
        Log("UpdateDriverForPlugAndPlayDevices ok=" + bound + " err=" + Marshal.GetLastWin32Error());

        // 3) The outcome is the verdict. A forced bind re-enumerates the device, which takes a
        // moment, so poll until it settles on WinUSB.
        string svc = null;
        bool present = false;
        for (int i = 0; i < 15; i++)
        {
            Thread.Sleep(400);
            svc = DeviceService("VID_0483&PID_DF11", out present);
            Log("poll " + i + " present=" + present + " service=" + svc);
            if (svc != null && svc.Equals("WinUSB", StringComparison.OrdinalIgnoreCase)) break;
        }
        if (svc != null && svc.Equals("WinUSB", StringComparison.OrdinalIgnoreCase))
        {
            WriteResult(resultPath, "ok", "DFU driver installed and device bound.");
            return 0;
        }
        if (!present)
        {
            WriteResult(resultPath, "staged-nodev", "Driver installed; no bootloader connected to bind yet.");
            return 0;
        }
        WriteResult(resultPath, "error", "The driver installed, but Windows has not attached WinUSB to the bootloader yet (currently: " + (svc ?? "none") + "). Reconnect the board and try again.");
        return 4;
    }

    // Is JMT Studio's package in the driver store? Every package Windows has staged has an
    // oem*.inf copy in %windir%\INF, and ours is the one naming our catalog file.
    static bool PackageStaged()
    {
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "INF");
        try
        {
            foreach (string f in Directory.GetFiles(dir, "oem*.inf"))
            {
                try
                {
                    if (File.ReadAllText(f).IndexOf(PACKAGE_CAT, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
                catch { }
            }
        }
        catch { }
        return false;
    }

    // The service (driver) bound to the first connected USB device whose instance ID contains
    // `match`, or null; `present` says whether such a device is connected at all.
    static string DeviceService(string match, out bool present)
    {
        present = false;
        IntPtr set = NativeMethods.SetupDiGetClassDevsW(IntPtr.Zero, "USB", IntPtr.Zero,
            NativeMethods.DIGCF_PRESENT | NativeMethods.DIGCF_ALLCLASSES);
        if (set == NativeMethods.INVALID_HANDLE_VALUE) return null;
        try
        {
            var data = new NativeMethods.SP_DEVINFO_DATA();
            data.cbSize = (uint)Marshal.SizeOf(typeof(NativeMethods.SP_DEVINFO_DATA));
            for (uint i = 0; NativeMethods.SetupDiEnumDeviceInfo(set, i, ref data); i++)
            {
                string id = InstanceId(set, ref data);
                if (id == null || id.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0) continue;
                present = true;
                return RegistryProperty(set, ref data, NativeMethods.SPDRP_SERVICE) ?? "";
            }
        }
        finally { NativeMethods.SetupDiDestroyDeviceInfoList(set); }
        return null;
    }

    // ── webusb ──

    static int WebUsb(string serial, string resultPath)
    {
        if (serial == null || !System.Text.RegularExpressions.Regex.IsMatch(serial, "^[0-9A-Fa-f]{12}$"))
        {
            WriteResult(resultPath, "error", "Not a board serial: " + serial);
            return 2;
        }

        string prefix = null;
        using (var k = Registry.LocalMachine.OpenSubKey("SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_1209&PID_6668\\" + serial))
        {
            if (k != null) prefix = k.GetValue("ParentIdPrefix") as string;
        }
        if (string.IsNullOrEmpty(prefix))
        {
            WriteResult(resultPath, "error", "Windows has no record of this board.");
            return 3;
        }

        string instance = "USB\\VID_1209&PID_6668&MI_02\\" + prefix + "&0002";
        string paramsKey = "SYSTEM\\CurrentControlSet\\Enum\\USB\\VID_1209&PID_6668&MI_02\\" + prefix + "&0002\\Device Parameters";

        Log("remove " + instance + ": " + RemoveDevice(instance));

        // The descriptor cache is keyed by VID, PID and device revision; clear every revision
        // this board family has used rather than guess one.
        using (var flags = Registry.LocalMachine.OpenSubKey("SYSTEM\\CurrentControlSet\\Control\\usbflags", true))
        {
            if (flags != null)
            {
                foreach (string name in flags.GetSubKeyNames())
                {
                    if (!name.StartsWith("12096668", StringComparison.OrdinalIgnoreCase)) continue;
                    try { flags.DeleteSubKeyTree(name); Log("cleared usbflags\\" + name); }
                    catch (Exception e) { Log("usbflags\\" + name + ": " + e.Message); }
                }
            }
        }

        Log("rescan: " + Rescan());

        // The outcome is the verdict: poll until the GUID lands (about 7 s when measured).
        for (int i = 0; i < 30; i++)
        {
            Thread.Sleep(500);
            object g = null;
            using (var k = Registry.LocalMachine.OpenSubKey(paramsKey))
            {
                if (k != null) g = k.GetValue("DeviceInterfaceGUIDs");
            }
            string text = g is string[] ? string.Join(" ", (string[])g) : (g as string);
            if (text != null && System.Text.RegularExpressions.Regex.IsMatch(text, "\\{[0-9A-Fa-f-]{36}\\}"))
            {
                WriteResult(resultPath, "ok", "WebUSB is set up for this board.");
                return 0;
            }
        }
        WriteResult(resultPath, "still-missing", "Windows did not pick up the WebUSB setting. Unplug the board and plug it back in.");
        return 4;
    }

    // Remove one device node, as Device Manager's Uninstall device does. True when removed.
    static bool RemoveDevice(string instanceId)
    {
        IntPtr set = NativeMethods.SetupDiCreateDeviceInfoList(IntPtr.Zero, IntPtr.Zero);
        if (set == NativeMethods.INVALID_HANDLE_VALUE) return false;
        try
        {
            var data = new NativeMethods.SP_DEVINFO_DATA();
            data.cbSize = (uint)Marshal.SizeOf(typeof(NativeMethods.SP_DEVINFO_DATA));
            if (!NativeMethods.SetupDiOpenDeviceInfoW(set, instanceId, IntPtr.Zero, 0, ref data))
            {
                Log("open " + instanceId + " err=" + Marshal.GetLastWin32Error());
                return false;
            }
            bool reboot;
            bool ok = NativeMethods.DiUninstallDevice(IntPtr.Zero, set, ref data, 0, out reboot);
            if (!ok) Log("DiUninstallDevice err=" + Marshal.GetLastWin32Error());
            return ok;
        }
        finally { NativeMethods.SetupDiDestroyDeviceInfoList(set); }
    }

    // Ask Windows to look for new hardware from the root of the device tree. 0 = CR_SUCCESS.
    static int Rescan()
    {
        uint root;
        int cr = NativeMethods.CM_Locate_DevNodeW(out root, null, 0);
        if (cr != 0) return cr;
        return NativeMethods.CM_Reenumerate_DevNode(root, 0);
    }

    // ── shared ──

    static string InstanceId(IntPtr set, ref NativeMethods.SP_DEVINFO_DATA data)
    {
        var sb = new StringBuilder(512);
        int req;
        return NativeMethods.SetupDiGetDeviceInstanceIdW(set, ref data, sb, sb.Capacity, out req) ? sb.ToString() : null;
    }

    static string RegistryProperty(IntPtr set, ref NativeMethods.SP_DEVINFO_DATA data, uint prop)
    {
        var buf = new byte[1024];
        uint type, req;
        if (!NativeMethods.SetupDiGetDeviceRegistryPropertyW(set, ref data, prop, out type, buf, (uint)buf.Length, out req)) return null;
        return Encoding.Unicode.GetString(buf, 0, (int)req).TrimEnd('\0');
    }

    static void WriteResult(string path, string status, string detail)
    {
        Log("result " + status + ": " + detail);
        if (string.IsNullOrEmpty(path)) return;
        string json = "{\"status\":" + JsonString(status) + ",\"detail\":" + JsonString(detail) + "}";
        try { File.WriteAllText(path, json, new UTF8Encoding(false)); }
        catch (Exception e) { Log("result write failed: " + e.Message); }
    }

    static string JsonString(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (char c in s ?? "")
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    static Dictionary<string, string> ParseArgs(string[] args)
    {
        var d = new Dictionary<string, string>();
        for (int i = 1; i + 1 < args.Length; i += 2)
        {
            if (args[i].StartsWith("--")) d[args[i].Substring(2)] = args[i + 1];
        }
        return d;
    }

    static string Arg(Dictionary<string, string> a, string k)
    {
        string v;
        return a.TryGetValue(k, out v) ? v : null;
    }
}

static class NativeMethods
{
    public const uint INSTALLFLAG_FORCE = 1;
    public const uint DIGCF_PRESENT = 0x2;
    public const uint DIGCF_ALLCLASSES = 0x4;
    public const uint SPDRP_SERVICE = 0x4;
    public static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    public struct SP_DEVINFO_DATA
    {
        public uint cbSize;
        public Guid ClassGuid;
        public uint DevInst;
        public IntPtr Reserved;
    }

    [DllImport("newdev.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool DiInstallDriverW(IntPtr hwndParent, string infPath, uint flags, out bool needReboot);

    [DllImport("newdev.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool UpdateDriverForPlugAndPlayDevicesW(IntPtr hwndParent, string hardwareId, string fullInfPath, uint installFlags, out bool rebootRequired);

    [DllImport("newdev.dll", SetLastError = true)]
    public static extern bool DiUninstallDevice(IntPtr hwndParent, IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, uint flags, out bool needReboot);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SetupDiGetClassDevsW(IntPtr classGuid, string enumerator, IntPtr hwndParent, uint flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    public static extern IntPtr SetupDiCreateDeviceInfoList(IntPtr classGuid, IntPtr hwndParent);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetupDiOpenDeviceInfoW(IntPtr deviceInfoSet, string deviceInstanceId, IntPtr hwndParent, uint openFlags, ref SP_DEVINFO_DATA deviceInfoData);

    [DllImport("setupapi.dll", SetLastError = true)]
    public static extern bool SetupDiEnumDeviceInfo(IntPtr deviceInfoSet, uint memberIndex, ref SP_DEVINFO_DATA deviceInfoData);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetupDiGetDeviceInstanceIdW(IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, StringBuilder deviceInstanceId, int deviceInstanceIdSize, out int requiredSize);

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetupDiGetDeviceRegistryPropertyW(IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, uint property, out uint propertyRegDataType, byte[] propertyBuffer, uint propertyBufferSize, out uint requiredSize);

    [DllImport("setupapi.dll", SetLastError = true)]
    public static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    public static extern int CM_Locate_DevNodeW(out uint devInst, string deviceId, uint flags);

    [DllImport("cfgmgr32.dll")]
    public static extern int CM_Reenumerate_DevNode(uint devInst, uint flags);
}
