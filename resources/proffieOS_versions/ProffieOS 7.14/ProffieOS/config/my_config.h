// ProffieOS7 Config File for Two Button V8.1 modified
#ifdef CONFIG_TOP 

// ------------ Board & Hardware Setup ------------
#include "proffieboard_v3_config.h"
#define NUM_BLADES 2                           	// Number of blade definitions in CONFIG_PRESETSs
#define NUM_BUTTONS 2                          	// Number of physical buttons4444
const unsigned int maxLedsPerStrip = 144;      	// Max LEDs per strip (important for memory allocation)
#define EXTRA_COLOR_BUFFER_SPACE 60            	// Adds buffer space to avoid color artifacts on longer blades
#define SHARED_POWER_PINS                      	// Allows power pins to be shared between blades

// ------------ Charge Settings ------------
#define CHARGE_DETECT_PIN 7                    	// Pin used for charge mode detection (Free1)
#define CHARGE_FULL_ENTER     32750    			    // ~99.8%
#define CHARGE_FULL_EXIT      32300    			    // ~98.6%
#define CHARGE_FULL_DWELL_MS  45000    			    // 45 seconds (balanced approach to true full reading)
#define JMT_CHARGE_LOCKOUT						          // Enables lockout of controls while charging
#define JMT_CHARGE_STYLE_PRESET					        // Enables last preset to be a charge style based on current blade config
#define JMT_CHARGE_COMPLETE_ANNOUNCE			      // Annonces charge complete on smoothed 100%

// ------------ Blade Variables ------------
#define NUM_SWITCH_LEDS 6                      	// Defines number of switch LEDs for use in blade configs

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
//#define FILTER_CUTOFF_FREQUENCY 100           // [24mm] Conservative cutoff for smaller speakers to reduce bass stress
#define FILTER_CUTOFF_FREQUENCY 80           	  // [28mm] Lower cutoff to allow more bass while still protecting the speaker
#define FILTER_ORDER 8                         	// Steepness of the filter roll-off (Butterworth order)

// ------------ Power & Idle Management ------------
#define MOTION_TIMEOUT (60 * 6 * 1000)        	// Time (ms) to shut down after inactivity (15 minutes)
#define IDLE_OFF_TIME (60 * 7 * 1000)         	// Time (ms) to power down completely after idle

// ------------ Blade Detect & ID Monitoring ------------
#define NO_BLADE_ID_RANGE 40000,100000         	// ID reading range interpreted as "no blade"
#define BLADE_ID_SCAN_MILLIS 500              	// Interval between automatic Blade ID scans (ms)
#define BLADE_ID_TIMES 10                      	// Number of samples averaged for each ID scan
#define ENABLE_POWER_FOR_ID PowerPINS<bladePowerPin2, bladePowerPin3> // Power blade during ID read for stable measurement
#define BLADE_ID_STOP_SCAN_WHILE_IGNITED        // Disable ID scanning while blade is ignited
#define JMT_BLADE_DETECT						            // Use the JMT Blade Detect method to include Blade Detect features on Blade ID

// ------------ Preset Behavior ------------
#define SAVE_VOLUME                            	// Remembers last used volume
#define SAVE_PRESET                            	// Remembers last used preset
#define NO_REPEAT_RANDOM                       	// Prevents the same random sound from playing twice in a row

// ------------ Fett263 Enhancements ------------
//#define DISABLE_COLOR_CHANGE                	// Disables color change to prevent accidental changes or breaking styles   
#define FETT263_DUAL_MODE_SOUND                	// Use blade orientation to choose ignition sound
#define FETT263_CLASH_STRENGTH_SOUND           	// Varies clash sounds based on impact intensity
#define FETT263_MAX_CLASH 16                   	// Max number of clash levels for strength-based sounds
#define FETT263_MULTI_PHASE                    	// Enables multi-phase ignition and retraction
#define FETT263_SAY_COLOR_LIST                 	// Voice feedback for color list in Edit Mode
//#define FETT263_SAY_COLOR_LIST_CC             // Adds Color Change mode announcement of color list
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

#ifdef CONFIG_PROP
#include "../props/jmt_fett_prop.h"
#endif

#ifdef CONFIG_PRESETS
#include "../functions/charge_full_prop.h" 		  //custom function for charge state during charing styles
#include "G:\My Drive\Ryan\Lightsaber\ProffieOS Versions\my_styles.h"

Preset presets[] = {

{ "Father;common", "Father/tracks/track1.wav",
  StylePtr<MainHyperResponsiveRotoscopeVader>(),
  StylePtr<CrystalChamberAccelWrapper<MainHyperResponsiveRotoscopeVader,0>>("65535,0,0"),

  "Vader"
  },

{ "Luke_EP6;common", "Luke_EP6/tracks/track1.wav",
  StylePtr<MainRotoscopeSingleColorOriginalTrilogyBaseColor>("0,65535,0"),
  StylePtr<CrystalChamberAccelWrapper<MainRotoscopeSingleColorOriginalTrilogyBaseColor,0>>("0,65535,0"),

  "Luke"
  },

{ "ChargeFont;common", "",
  ChargingStylePtr<BatteryBladeStyle>(),
  StylePtr<ChargingButtonStyle<>>(),

  "Charging"
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
CONFIGARRAY(presets),
},
  
};

#endif

#ifdef CONFIG_BUTTONS
Button PowerButton(BUTTON_POWER, powerButtonPin, "pow");
Button AuxButton(BUTTON_AUX, auxPin, "aux");
#endif