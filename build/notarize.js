const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== "darwin") return;

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log("Skipping notarization: APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);

  return await notarize({
    tool: "notarytool",
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: "MJ2AAJ6PK5",
  });
};
