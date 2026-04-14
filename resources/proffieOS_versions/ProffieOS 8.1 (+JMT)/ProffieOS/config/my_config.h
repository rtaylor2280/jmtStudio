// ProffieOS7 Config File for Single Button V8.1 with JMT Prop
/*-----------------------------------------------------------------
No Charge Detect on this saber. There is a wired blade detect pin 
and a second data pint on the NPXL, but neither of these are used
and not needed with this config 
-----------------------------------------------------------------*/
#ifdef CONFIG_TOP 

// ------------ Board & Hardware Setup ------------
#include "proffieboard_v3_config.h"
#define NUM_BLADES 2                           	// Number of blade definitions in CONFIG_PRESETS
#define NUM_BUTTONS 1                          	// Number of physical buttons
const unsigned int maxLedsPerStrip = 144;      	// Max LEDs per strip (important for memory allocation)
#define EXTRA_COLOR_BUFFER_SPACE 60            	// Adds buffer space to avoid color artifacts on longer blades
#define SHARED_POWER_PINS                      	// Allows power pins to be shared between blades

// ------------ Blade Variables ------------
#define NUM_SWITCH_LEDS 2                      	// Defines number of switch LEDs for use in blade configs

// ------------ Audio & Motion Settings ------------
#define VOLUME 1800                            	// Master volume (0–2047)
#define BOOT_VOLUME 200                        	// Startup volume during boot
#define CLASH_THRESHOLD_G 2.0                  	// Clash sensitivity (lower = more sensitive)
#define ENABLE_AUDIO                           	// Enables audio playback
#define ENABLE_MOTION                          	// Enables motion sensing (gyro/accel)
#define ENABLE_WS2811                          	// Enables NeoPixel (WS2811) LED output
#define ENABLE_SD                              	// Enables SD card support for sound fonts
#define KILL_OLD_PLAYERS                       	// Stops old sounds before starting new ones

// ------------ Audio Filtering ------------
#define FILTER_CUTOFF_FREQUENCY 85              // [25mm KR] Lower cutoff: allows more low-end from larger driver in good enclosure
#define FILTER_ORDER 4                          // Moderate roll-off: sufficient protection with more natural response

// ------------ Power & Idle Management ------------
#define MOTION_TIMEOUT (60 * 6 * 1000)        	// Time (ms) to shut down after inactivity (15 minutes)
#define IDLE_OFF_TIME (60 * 7 * 1000)         	// Time (ms) to power down completely after idle

// ------------ Blade Detect & ID Monitoring ------------
#define BLADE_ID_SCAN_MILLIS 500              	// Interval between automatic Blade ID scans (ms)
#define BLADE_ID_TIMES 10                      	// Number of samples averaged for each ID scan
#define NO_BLADE_ID_RANGE 40000,100000         	// ID reading range interpreted as "no blade"
#define ENABLE_POWER_FOR_ID PowerPINS<bladePowerPin2, bladePowerPin3> // Power blade during ID read for stable measurement
#define BLADE_ID_STOP_SCAN_WHILE_IGNITED        // Disable ID scanning while blade is ignited
#define JMT_BLADE_DETECT						            // Use the JMT Blade Detect method to include Blade Detect features on Blade ID

// ------------ Preset Behavior ------------
#define SAVE_VOLUME                            	// Remembers last used volume
#define SAVE_PRESET                            	// Remembers last used preset
#define NO_REPEAT_RANDOM                       	// Prevents the same random sound from playing twice in a row

// ------------ Fett263 Enhancements ------------
#define FETT263_DUAL_MODE_SOUND                	// Use blade orientation to choose ignition sound
#define FETT263_CLASH_STRENGTH_SOUND           	// Varies clash sounds based on impact intensity
#define FETT263_MAX_CLASH 16                   	// Max number of clash levels for strength-based sounds
#define FETT263_MULTI_PHASE                    	// Enables multi-phase ignition and retraction
#define FETT263_SAY_COLOR_LIST                 	// Voice feedback for color list in Edit Mode
#define FETT263_SAY_BATTERY_PERCENT            	// Saber announces battery level percentage
#define FETT263_MOTION_WAKE_POWER_BUTTON       	// Wake from deep sleep with motion + power button
#define FETT263_QUOTE_PLAYER_START_ON          	// Starts in quote mode
#define FETT263_SAVE_GESTURE_OFF               	// Remembers if gesture-off was last used
#define FETT263_DISABLE_CHANGE_FONT            	// Disables font change via edit menu
#define FETT263_DISABLE_CHANGE_STYLE           	// Disables style change via edit menu
#define FETT263_DISABLE_COPY_PRESET            	// Disables copying of presets via edit menu
#define FETT263_DISABLE_BM_TOGGLE              	// Disables battle mode toggle via Edit Mode
#define FETT263_BM_DISABLE_SAVE                	// Prevents saving battle mode state
#define FETT263_LOCKUP_DELAY 200               	// Delay (ms) after ignition before lockup is allowed
#define FETT263_BM_CLASH_DETECT 6              	// Clash sensitivity in battle mode
#define FETT263_BM_DISABLE_OFF_BUTTON          	// Prevents using power button to turn off in battle mode
#define FETT263_SWING_ON_SPEED 200             	// Swing-on gesture speed threshold in ms
#define FETT263_SWING_ON                       	// Enables swing-on ignition
#define FETT263_SWING_ON_NO_BM                 	// Swing-on works outside of battle mode
#define FETT263_TWIST_ON                       	// Enables twist-on ignition
#define FETT263_TWIST_ON_NO_BM                 	// Twist-on works outside of battle mode
#define FETT263_THRUST_ON                      	// Enables thrust-on ignition
#define FETT263_TWIST_OFF                      	// Enables twist-off retraction

// ------------ Optional Cleanup ------------
#define DISABLE_BASIC_PARSER_STYLES            	// Excludes default style parser for size savings
#define DISABLE_DIAGNOSTIC_COMMANDS            	// Excludes serial debug commands to reduce code size

#endif

#ifdef CONFIG_PRESETS
#include "../functions/charge_full_prop.h" 		  //custom function for charge state during charing styles
#include "G:\My Drive\Ryan\Lightsaber\ProffieOS Versions\my_styles.h"

Preset presets[] = {
 
{ "Luke_EP6;common",  "Luke_EP6/tracks/track1.wav",
  StylePtr<MainRotoscopeSingleColorOriginalTrilogyBaseColor>("0,65535,0"),
  StylePtr<PixelSwitchWrapper<MainRotoscopeSingleColorOriginalTrilogyBaseColor>>("0,65535,0"),

  "Luke"
  },

{ "Father;common",  "Father/tracks/track1.wav",
  StylePtr<MainHyperResponsiveRotoscopeVader>(),
  StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopeVader>>("65535,0,0"),

  "Vader"
  },

{ "Jinn_EP1;common",  "Jinn_EP1/tracks/track1.wav",
  StylePtr<MainHyperResponsiveRotoscopePrequelsBaseColor>("0,65535,0"),
  StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopePrequelsBaseColor>>("0,65535,0"),

  "Qui-Gon"
  },
  
{ "Dark_Apprentice;common",  "Dark_Apprentice/tracks/track1.wav",
  StylePtr<MainHyperResponsiveRotoscopePrequelsBaseColor>("65535,0,0"),
  StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopePrequelsBaseColor>>("65535,0,0"),

  "Maul"
  },

{ "OB_EP3;common",  "OB_EP3/tracks/AniObi-trk.wav",
  StylePtr<MainHyperResponsiveRotoscopePrequelsBaseColor>("0,0,65535"),
  StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopePrequelsBaseColor>>("0,0,65535"),

  "Obi-Wan"
  },

{ "Dark_Ani;common",  "Dark_Ani/tracks/AniObi-trk.wav",
  StylePtr<MainHyperResponsiveRotoscopePrequelsBaseColor>("0,0,65535"),
  StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopePrequelsBaseColor>>("0,0,65535"),

  "Anakin"
  },

{ "Little_Green_Master;common",  "",
  StylePtr<MainHyperResponsiveRotoscopePrequelsBaseColor>("0,65535,0"),
  StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopePrequelsBaseColor>>("0,65535,0"),

  "Yoda"
  },

{ "Master_Mace;common",  "Master_Mace/tracks/Mace Windu vs Palpatine.wav",
  StylePtr<MainHyperResponsiveRotoscopePrequelsBaseColor>("30326,0,49858"),
  StylePtr<PixelSwitchWrapper<MainHyperResponsiveRotoscopePrequelsBaseColor>>("30326,0,49858"),

  "Mace Windu"
  },

{ "DarkBeskar;common",  "DarkBeskar/tracks/mando_theme.wav",
  StylePtr<MainLiveActionDarksaberHyperResponsiveBaseColor>(),
  StylePtr<PixelSwitchWrapper<MainLiveActionDarksaberHyperResponsiveBaseColor>>("25700,25700,38550"),

  "Darksaber"
  },

{ "TanosBlade;common",  "TanosBlade/tracks/track1.wav",
  StylePtr<MainAhsokaTanoBaseColor>(),
  StylePtr<PixelSwitchWrapper<MainAhsokaTanoBaseColor>>("25700,25700,38550"),

  "Ahsoka"
  },

{ "Sabine;common",  "Sabine/tracks/track1.wav",
  StylePtr<ControlMainSabineWrenBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainSabineWrenBaseColor>>("0,65535,0"),

  "Sabine"
  },
  
{ "Skoll;common",  "Skoll/tracks/track1.wav",
  StylePtr<MainBaylanSkollBaseColor>(),
  StylePtr<PixelSwitchWrapper<MainBaylanSkollBaseColor>>("65535,3598,0"),

  "Skoll"
  },

{ "Moon-Hati;common",  "Moon-Hati/tracks/track1.wav",
  StylePtr<ControlMainShinHatiBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainShinHatiBaseColor>>("65535,3598,0"),
  
  "Shin Hati"
  },

{ "Blind_Cowboy;common",  "",
  StylePtr<ControlMainEzraBridgerBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainEzraBridgerBaseColor>>("0,0,65535"),

  "Kannan Jarrus"
  },

{ "Nomad;common",  "",
  StylePtr<ControlMainEzraBridgerBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainEzraBridgerBaseColor>>("0,0,65535"),

  "Ezra Bridger"
  },

{ "Survivor2-Blue;common",  "Survivor2-Blue/tracks/cal-trk.wav",
   StylePtr<MainCalKestisSurvivorBlueBaseColor>(),
   StylePtr<PixelSwitchWrapper<MainCalKestisSurvivorBlueBaseColor>>("0,0,65535"),
  
   "Cal Kestis"
  },

{ "RENvious;common",  "RENvious/tracks/track1.wav",
  StylePtr<MainKyloRenUnstableFilmBasedBaseColor>(),
  StylePtr<PixelSwitchWrapper<MainKyloRenUnstableFilmBasedBaseColor>>("65535,0,0"),

  "Kylo Ren"
  },

{ "Fire;common",  "common/tracks/mars.wav",
  StylePtr<MainResponsiveFlameRealFlameGradientBaseColor>(),
  StylePtr<PixelSwitchWrapper<MainResponsiveFlameRealFlameGradientBaseColor>>("65535,7816,0"),

  "Fire Blade"
  },

{ "The_Water_Saber;common",  "The_Water_Saber/tracks/Donkey_Kong_Country_Aquatic_Ambience.wav",
  StylePtr<MainInteractiveWaterBladeBaseColor>(),
  StylePtr<PixelSwitchWrapper<MainInteractiveWaterBladeBaseColor>>("0,34695,65535"),

  "Water Blade"
  },
  
{ "lightsaber_of_the_bells_2;common",  "lightsaber_of_the_bells_2/tracks/Star Wars The Mandalorian Theme x Carol of The Bells  EPIC CHRISTMAS MIX.wav",
  StylePtr<MainChristmasTreeMultiColoredLightsBaseColor>(),
  StylePtr<ChristmasPixelSwitchWrapper<PixelSwitchStandard>>("0,65535,0"),

  "Water Blade"
  },
  
{ "Skotos;common", "common/tracks/mercury.wav",
  StylePtr<GreyscaleFontsSkotos>(),
  StylePtr<PixelSwitchWrapper<GreyscaleFontsSkotos>>("17219,0,29555"),
  
  "Skotos"
  },
  
{ "Defect;common", "common/tracks/mercury.wav",
  StylePtr<GreyscaleFontsDefect>(),
  StylePtr<PixelSwitchWrapper<GreyscaleFontsDefect>>("65535,0,0"),
  
  "Defect"
  },
  
{ "Binary_Light;common", "common/tracks/mars.wav",
  StylePtr<GreyscaleFontsBinary_Light>(),
  StylePtr<PixelSwitchWrapper<GreyscaleFontsBinary_Light>>("8357,8357,20393"),
  
  "Binary"
  },
  
{ "Null;common", "common/tracks/mars.wav",
  StylePtr<GreyscaleFontsNull>(),
  StylePtr<PixelSwitchWrapper<GreyscaleFontsNull>>("20560,12850,53970"),
  
  "Null"
  },
  
{ "Analog;common", "",
  StylePtr<ControlMainAnalogAudioFlickerwithRippleSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainAnalogAudioFlickerwithRippleSwingBaseColor>>("0,34695,65535"),

  "Analog"
  },

{ "Apocalypse;common", "",
  StylePtr<ControlMainApocalypseSwingSpeedSplitBladeBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainApocalypseSwingSpeedSplitBladeBaseColor>>("65535,0,0"),

  "Apocalypse"
  },

{ "Assassin;common", "",
  StylePtr<ControlMainAssasinHumpFlickerRippleSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainAssasinHumpFlickerRippleSwingBaseColor>>("0,65535,0"),

  "Assassin"
  },

{ "Coda;common", "",
  StylePtr<ControlMainCODARollingPulsewithUnstableSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainCODARollingPulsewithUnstableSwingBaseColor>>("7710,37008,65535"),

  "Coda"
  },

{ "Deadlink;common", "",
  StylePtr<ControlMainDeadlinkHumpFlickerwithRippleSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainDeadlinkHumpFlickerwithRippleSwingBaseColor>>("65535,0,65535"),

  "Deadlink"
  },

{ "Exalted;common", "",
  StylePtr<ControlMainExaltedUnstableBladeRippleSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainExaltedUnstableBladeRippleSwingBaseColor>>("65535,0,0"),

  "Exalted"
  },

{ "Grey;common", "",
  StylePtr<ControlMainGreyAudioFlickerRippleSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainGreyAudioFlickerRippleSwingBaseColor>>("25700,25700,38550"),

  "Grey"
  },

{ "Magnetic;common", "",
  StylePtr<ControlMainMagneticLavaLampwithFlickerBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainMagneticLavaLampwithFlickerBaseColor>>("0,65535,52171"),

  "Magnetic"
  },

{ "Masterless;common", "",
  StylePtr<ControlMainMasterlessRotoscopewithColorSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainMasterlessRotoscopewithColorSwingBaseColor>>("65535,65535,0"),

  "Masterless"
  },

{ "Mercenary;common", "",
  StylePtr<ControlMainMercenarySmokeBladewithRippleSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainMercenarySmokeBladewithRippleSwingBaseColor>>("65535,65535,0"),

  "Mercenary"
  },

{ "Seethe;common", "",
  StylePtr<ControlMainSeetheAudioFlickerUnstableSwingBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainSeetheAudioFlickerUnstableSwingBaseColor>>("65535,0,0"),

  "Seethe"
  },

{ "Splinter;common", "",
  StylePtr<ControlMainSplinterSwingSpeedSplitBladeBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainSplinterSwingSpeedSplitBladeBaseColor>>("65535,17476,0"),

  "Splinter"
  },

{ "Stitched;common", "",
  StylePtr<GreyscaleFontsStitched>(),
  StylePtr<PixelSwitchWrapper<GreyscaleFontsStitched>>("13655,53737,65535"),

  "stitched"},


{ "Volatile;common", "",
  StylePtr<ControlMainVolatileTwoColorRotatingSwingSpeedAudioFlickerBaseColor>(),
  StylePtr<PixelSwitchWrapper<ControlMainVolatileTwoColorRotatingSwingSpeedAudioFlickerBaseColor>>("0,0,65535"),

  "Volatile"
  },

{ "Paradise;common",  "common/tracks/mars.wav",
  StylePtr<MainPinkToBlueSparkle>(),
  StylePtr<PixelSwitchWrapper<MainPinkToBlueSparkle>>("12029,0,35913"),

"Paradise"
},

{ "Techno;common",  "",
  StylePtr<ControlMainRainbowBlade>(),
  StylePtr<RainbowSwitch>(),

  "Techno"
},

{ "Excalibur;common", "",
  StylePtr<WhiteBlue>(),
  StylePtr<PixelSwitchWrapper<WhiteBlue>>("51400,51400,65535"),

  "Excalibur"
  },

{ "Origin;common", "Origin/tracks/origin.wav",
  StylePtr<Origin>(),
  StylePtr<PixelSwitchWrapper<Origin>>("29555,3855,56540"),

  "Origin"
  },
  
{ "Quantum2;common", "Quantum/tracks/track01.wav",
  StylePtr<QuantumStyle2>(),
  StylePtr<PixelSwitchWrapper<QuantumStyle2>>("0,51400,51400"),

  "QuantumStyle2"
  },
  
{ "Supernova;common", "Supernova/tracks/track1.wav",
  StylePtr<Supernova>(),
  StylePtr<PixelSwitchWrapper<Supernova>>("65535,0,0"),

  "Supernova"
  },

{ "VoltBlade;common", "VoltBlade/tracks/track01.wav",
  StylePtr<VoltBlade>(),
  StylePtr<PixelSwitchWrapper<VoltBlade>>("7710,37008,65535"),

  "VoltBlade"
  },  
};

BladeConfig blades[] = {
  
// JMT Octocore 33" Blade
{ 3000, 
WS281XBladePtr<128, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3>>(),
DimBlade(30.0, WS281XBladePtr<NUM_SWITCH_LEDS, blade2Pin, Color8::GRB, PowerPINS<bladePowerPin4>>()),
CONFIGARRAY(presets)
},

// Basic 32" Blade (TXQ from 1977SaberFeast)
{ 8030,
WS281XBladePtr<116, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3>>(),
DimBlade(30.0, WS281XBladePtr<NUM_SWITCH_LEDS, blade2Pin, Color8::GRB, PowerPINS<bladePowerPin4>>()),
CONFIGARRAY(presets)
},

// JMT 36" Blade (No resistor)
{ 16300, 
WS281XBladePtr<129, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3>>(),
DimBlade(30.0, WS281XBladePtr<NUM_SWITCH_LEDS, blade2Pin, Color8::GRB, PowerPINS<bladePowerPin4>>()),
CONFIGARRAY(presets)
},

// NPXL Connector Active (Blade Removed)
{ NO_BLADE, 
WS281XBladePtr<16, bladePin, Color8::GRB, PowerPINS<bladePowerPin2, bladePowerPin3>>(),
DimBlade(30.0, WS281XBladePtr<NUM_SWITCH_LEDS, blade2Pin, Color8::GRB, PowerPINS<bladePowerPin4>>()),
CONFIGARRAY(presets)
},
  
};

#endif

//prop must be defined at end to ensure order of variables defined supports JMT charge features
#ifdef CONFIG_PROP
#include "../props/jmt_fett_prop.h"
#undef  PROP_TYPE
#define PROP_TYPE JMTFettProp
#endif

#ifdef CONFIG_BUTTONS
Button PowerButton(BUTTON_POWER, powerButtonPin, "pow");
#endif