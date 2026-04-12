#ifdef CONFIG_TOP

// ------------ Board & Hardware Setup ------------
#include "proffieboard_v3_config.h"
#define NUM_BLADES 2
#define NUM_BUTTONS 1
const unsigned int maxLedsPerStrip = 144;
#define CHARGE_DETECT_PIN 7  // Pin used for charge mode detection

// ------------ Audio & Motion Settings ------------
#define VOLUME 1900
#define BOOT_VOLUME 200
#define CLASH_THRESHOLD_G 0.8
#define ENABLE_AUDIO
#define ENABLE_MOTION
#define ENABLE_WS2811
#define ENABLE_SD
#define KILL_OLD_PLAYERS

// ------------ Audio Filtering ------------
#define FILTER_CUTOFF_FREQUENCY 150  // High-pass filter to protect speaker from low-end stress
#define FILTER_ORDER 8               // Steepness of the filter roll-off (Butterworth order)

// ------------ Power & Idle Management ------------
#define MOTION_TIMEOUT (60 * 6 * 1000)
#define IDLE_OFF_TIME (60 * 7 * 1000)

// ------------ Preset Behavior ------------
#define SAVE_VOLUME          // Remembers last used volume
#define SAVE_PRESET          // Remembers last used preset
#define NO_REPEAT_RANDOM     // Prevents the same preset playing back-to-back when randomized
#define COLOR_CHANGE_DIRECT  // Color changes cycle directly without requiring hold/release

// ------------ Fett263 Enhancements ------------
#define FETT263_DUAL_MODE_SOUND                	// Use blade orientation to choose ignition sound
#define FETT263_CLASH_STRENGTH_SOUND           	// Varies clash sounds based on impact intensity
#define FETT263_MAX_CLASH 16                   	// Max number of clash levels for strength-based sounds
#define FETT263_MULTI_PHASE                    	// Enables multi-phase ignition and retraction
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
#define FETT263_SWING_ON_SPEED 450             	// Swing-on gesture speed threshold in ms
#define FETT263_SWING_ON                       	// Enables swing-on ignition
#define FETT263_SWING_ON_NO_BM                 	// Swing-on works outside of battle mode
#define FETT263_TWIST_ON                       	// Enables twist-on ignition
#define FETT263_TWIST_ON_NO_BM                 	// Twist-on works outside of battle mode
#define FETT263_THRUST_ON                      	// Enables thrust-on ignition
#define FETT263_TWIST_OFF                      	// Enables twist-off retraction

// ------------ Optional Cleanup ------------
#define DISABLE_BASIC_PARSER_STYLES         // Excludes default style parser for size savings
#define DISABLE_DIAGNOSTIC_COMMANDS         // Excludes serial debug commands to reduce code size

#endif

#ifdef CONFIG_PROP
#include "../props/saber_fett263_buttons.h"
#endif

#ifdef CONFIG_PRESETS
#include "my_styles.h"

Preset presets[] = {
  { "Defect;common", "",
  StylePtr<ControlMainCustomBladeMultiPhaseOriginalColorChange>(),
  StylePtr<AccentStaticRainbowFireFastBaseColor>(),
  
  "Defect"
  },

  { "TanosBlade;common",  "TanosBlade/tracks/track1.wav",
    /* copyright Fett263 Ahsoka (Primary Blade) OS7 Style
    https://www.fett263.com/fett263-proffieOS7-style-library.html#Ahsoka
    OS7.14 v3.23p
    Single Style
    Style Option
    Base Color: BaseColorArg (0)

    --Effects Included--
    Preon Effect: Sparking [Color: PreonColorArg]
    Ignition Effect: Fade Up [Color: IgnitionColorArg]
    Retraction Effect: Fade Out [Color: RetractionColorArg]
    Lockup Effect:
    0: mainLockMulti0Shape - Begin: Full Blade Flash - Style: Intensity AudioFlicker - End: Full Blade Absorb
    [Color: LockupColorArg]
    Lightning Block Effect:
    0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
    [Color: LBColorArg]
    Drag Effect: NoneMelt Effect: NoneBlast Effect: Full Blade Blast Fade [Color: BlastColorArg]
    Clash Effect: Flash on Clash (Full Blade) [Color: ClashColorArg]
    Battery Level: Full Blade (Green to Red)
    Display Volume: % Blade [Color: BaseColorArg]
    */
    StylePtr<Layers<AudioFlicker<Stripes<22000,-1400,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,Mix<Int<10000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,Mix<Int<18000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,InOutTrL<TrFadeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<2000>>,IntArg<PREON_SIZE_ARG,2000>,Sum<IntArg<PREON_SIZE_ARG,2000>,Int<4000>>>,Int<-2000>>>,TrDelayX<WavLen<EFFECT_PREON>>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>>(),
    StylePtr<PixelSwitchStandard>("25700,25700,38550"),
    "Ahsoka Tano"
  },

  { "Snips;common", "Snips/tracks/track1.wav",
    /* copyright Fett263 Rotoscope (Primary Blade) OS7 Style
    https://www.fett263.com/fett263-proffieOS7-style-library.html#Rotoscope
    OS7.14 v3.23p
    Single Style
    Style Option
    Base Color: BaseColorArg (0)

    --Effects Included--
    Preon Effect: Sparking [Color: PreonColorArg]
    Ignition Effect: Fade Up [Color: IgnitionColorArg]
    Retraction Effect: Fade Out [Color: RetractionColorArg]
    Lockup Effect:
    0: mainLockMulti0Shape - Begin: Full Blade Flash - Style: Intensity AudioFlicker - End: Full Blade Absorb
    [Color: LockupColorArg]
    Lightning Block Effect:
    0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
    [Color: LBColorArg]
    Drag Effect: NoneMelt Effect: NoneBlast Effect: Full Blade Blast Fade [Color: BlastColorArg]
    Clash Effect: Flash on Clash (Full Blade) [Color: ClashColorArg]
    Battery Level: Full Blade (Green to Red)
    Display Volume: % Blade [Color: BaseColorArg]
    */
    StylePtr<Layers<Mix<HoldPeakF<SwingSpeed<250>,Scale<SwingAcceleration<100>,Int<50>,Int<500>>,Scale<SwingAcceleration<>,Int<20000>,Int<10000>>>,RandomFlicker<StripesX<Int<15000>,Scale<HoldPeakF<SwingSpeed<200>,Scale<SwingAcceleration<100>,Int<50>,Int<300>>,Scale<SwingAcceleration<100>,Int<24000>,Int<16000>>>,Int<-3200>,Int<-200>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<19276>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,InOutTrL<TrFadeX<BendTimePowInvX<IgnitionTime<400>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<2000>>,IntArg<PREON_SIZE_ARG,2000>,Sum<IntArg<PREON_SIZE_ARG,2000>,Int<4000>>>,Int<-2000>>>,TrDelayX<WavLen<EFFECT_PREON>>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>>(),
    StylePtr<PixelSwitchStandard>("0,0,65535"),
    "Young Ahsoka Tano"
  },

  { "Survivor2-Blue;common",  "Survivor2-Blue/tracks/cal-trk.wav",
   StylePtr<ControlMainFallenOrderCalKestisBaseColor>(),
   StylePtr<PixelSwitchStandard>("32896,0,65535"),
  
   "Cal Kestis"
  },

  { "Darkbeskar;common", "Darkbeskar/tracks/mando_theme.wav",
  StylePtr<ControlMainLiveActionDarksaberHyperResponsiveBaseColor>(),
  StylePtr<PixelSwitchStandard>("49344,49344,49344"),
  
  "Dark Saber"
  },

  { "Sabine;common", "Sabine/tracks/track1.wav",
    /* copyright Fett263 Ahsoka (Primary Blade) OS7 Style
    https://www.fett263.com/fett263-proffieOS7-style-library.html#Ahsoka
    OS7.14 v3.23p
    Single Style
    Style Option
    Base Color: BaseColorArg (0)

    --Effects Included--
    Preon Effect: Sparking [Color: PreonColorArg]
    Ignition Effect: Fade Up [Color: IgnitionColorArg]
    Retraction Effect: Fade Out [Color: RetractionColorArg]
    Lockup Effect:
    0: mainLockMulti0Shape - Begin: Full Blade Flash - Style: Intensity AudioFlicker - End: Full Blade Absorb
    [Color: LockupColorArg]
    Lightning Block Effect:
    0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
    [Color: LBColorArg]
    Drag Effect: NoneMelt Effect: NoneBlast Effect: Full Blade Blast Fade [Color: BlastColorArg]
    Clash Effect: Flash on Clash (Full Blade) [Color: ClashColorArg]
    Battery Level: Full Blade (Green to Red)
    Display Volume: % Blade [Color: BaseColorArg]
    */
    StylePtr<Layers<AudioFlicker<Stripes<23000,-1300,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<11565>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<16448>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,InOutTrL<TrFadeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<2000>>,IntArg<PREON_SIZE_ARG,2000>,Sum<IntArg<PREON_SIZE_ARG,2000>,Int<4000>>>,Int<-2000>>>,TrDelayX<WavLen<EFFECT_PREON>>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>>(),
    StylePtr<PixelSwitchStandard>("0,65535,0"),
    "Sabine Wren"
  },

  { "Huyang;common", "Huyang/tracks/track1.wav",
    /* copyright Fett263 Rotoscope (Primary Blade) OS7 Style
    https://www.fett263.com/fett263-proffieOS7-style-library.html#Rotoscope
    OS7.14 v3.23p
    Single Style
    Style Option
    Base Color: BaseColorArg (0)

    --Effects Included--
    Preon Effect: Sparking [Color: PreonColorArg]
    Ignition Effect: Fade Up [Color: IgnitionColorArg]
    Retraction Effect: Fade Out [Color: RetractionColorArg]
    Lockup Effect:
    0: mainLockMulti0Shape - Begin: Full Blade Flash - Style: Intensity AudioFlicker - End: Full Blade Absorb
    [Color: LockupColorArg]
    Lightning Block Effect:
    0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
    [Color: LBColorArg]
    Drag Effect: NoneMelt Effect: NoneBlast Effect: Full Blade Blast Fade [Color: BlastColorArg]
    Clash Effect: Flash on Clash (Full Blade) [Color: ClashColorArg]
    Battery Level: Full Blade (Green to Red)
    Display Volume: % Blade [Color: BaseColorArg]
    */
    StylePtr<Layers<Mix<Sin<Int<16>,Int<32768>,Int<18000>>,RgbArg<BASE_COLOR_ARG,Rgb<255,255,0>>,Stripes<12000,-200,RgbArg<BASE_COLOR_ARG,Rgb<255,255,0>>,Mix<Int<20000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,255,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,255,0>>,Mix<Int<16448>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,255,0>>>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,InOutTrL<TrFadeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<2000>>,IntArg<PREON_SIZE_ARG,2000>,Sum<IntArg<PREON_SIZE_ARG,2000>,Int<4000>>>,Int<-2000>>>,TrDelayX<WavLen<EFFECT_PREON>>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,255,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>>(),
    StylePtr<PixelSwitchStandard>("65535,65535,0"),
    "Huyang Training Droid"
  },

  { "Paradise;common",  "",
    /* copyright Fett263 Rotoscope (Primary Blade) OS7 Style
    https://www.fett263.com/fett263-proffieOS7-style-library.html#Rotoscope
    OS7.14 v3.23p
    Single Style
    Style Option
    Base Color: BaseColorArg (0)

    --Effects Included--
    Preon Effect: Sparking [Color: PreonColorArg]
    Ignition Effect: Fade Up [Color: IgnitionColorArg]
    Retraction Effect: Fade Out [Color: RetractionColorArg]
    Lockup Effect:
    0: mainLockMulti0Shape - Begin: Full Blade Flash - Style: Intensity AudioFlicker - End: Full Blade Absorb
    [Color: LockupColorArg]
    Lightning Block Effect:
    0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
    [Color: LBColorArg]
    Drag Effect: NoneMelt Effect: NoneBlast Effect: Full Blade Blast Fade [Color: BlastColorArg]
    Clash Effect: Flash on Clash (Full Blade) [Color: ClashColorArg]
    Battery Level: Full Blade (Green to Red)
    Display Volume: % Blade [Color: BaseColorArg]
    */
    StylePtr<Layers<Mix<Sin<Int<16>,Int<32768>,Int<18000>>,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,Stripes<12000,-200,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,Mix<Int<20000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>>,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,Mix<Int<16448>,Black,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,InOutTrL<TrFadeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<2000>>,IntArg<PREON_SIZE_ARG,2000>,Sum<IntArg<PREON_SIZE_ARG,2000>,Int<4000>>>,Int<-2000>>>,TrDelayX<WavLen<EFFECT_PREON>>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>>(),  
    StylePtr<PixelSwitchStandard>("30326,0,49858"),
    "Paradise"
  },

  { "Father;common",  "Father/tracks/track1.wav",
    /* copyright Fett263 Rotoscope (Primary Blade) OS7 Style
    https://www.fett263.com/fett263-proffieOS7-style-library.html#Rotoscope
    OS7.14 v3.23p
    Single Style
    Style Option
    Base Color: BaseColorArg (0)

    --Effects Included--
    Preon Effect: Sparking [Color: PreonColorArg]
    Ignition Effect: Fade Up [Color: IgnitionColorArg]
    Retraction Effect: Fade Out [Color: RetractionColorArg]
    Lockup Effect:
    0: mainLockMulti0Shape - Begin: Full Blade Flash - Style: Intensity AudioFlicker - End: Full Blade Absorb
    [Color: LockupColorArg]
    Lightning Block Effect:
    0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
    [Color: LBColorArg]
    Drag Effect: NoneMelt Effect: NoneBlast Effect: Full Blade Blast Fade [Color: BlastColorArg]
    Clash Effect: Flash on Clash (Full Blade) [Color: ClashColorArg]
    Battery Level: Full Blade (Green to Red)
    Display Volume: % Blade [Color: BaseColorArg]
    */
    StylePtr<Layers<RandomFlicker<Stripes<10000,-2600,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Mix<Int<16448>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,InOutTrL<TrFadeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<2000>>,IntArg<PREON_SIZE_ARG,2000>,Sum<IntArg<PREON_SIZE_ARG,2000>,Int<4000>>>,Int<-2000>>>,TrDelayX<WavLen<EFFECT_PREON>>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>>(),
    StylePtr<PixelSwitchStandard>("65535,0,0"),
    "Darth Vader"
  },  

};

Preset charge_detect_presets[] = {
  { "ChargeFont;common", "",
    StylePtr<Black>(),
    ChargingStylePtr<
      Mix<
        IsGreaterThan<BatteryLevel, Int<32767>>,  // =100% Full Charge

        // FALSE: Battery < 100%
        Mix<
          CircularSectionF<Saw<Scale<Mult<BatteryLevel, BatteryLevel>, Int<10>, Int<100>>>, Int<12000>>,  // Animated ring sweep
          Black,
          Mix<
            IsGreaterThan<BatteryLevel, Int<29491>>,  // >90%
            Mix<
              IsGreaterThan<BatteryLevel, Int<24576>>,  // >75%
              Mix<
                IsGreaterThan<BatteryLevel, Int<16384>>,  // >50%
                Mix<
                  IsGreaterThan<BatteryLevel, Int<8192>>,  // >25%
                  Red,
                  Mix<BatteryLevel, Red, OrangeRed>
                >,
                Mix<BatteryLevel, OrangeRed, Orange>
              >,
              Mix<BatteryLevel, Orange, Yellow>
            >,
            Mix<BatteryLevel, Yellow, GreenYellow>
          >
        >,

        // TRUE: Battery == 100%
        Pulsing<Black, Rgb<0,255,0>, 8000>
      >
    >(), 

    "Charging"
  }
};

BladeConfig blades[] = {
  {
    0,
    SimpleBladePtr<CreeXPE2RedTemplate<5600>, CreeXPE2GreenTemplate<3900>, CreeXPE2BlueTemplate<3600>, NoLED, bladePowerPin1, bladePowerPin2, bladePowerPin3, -1>(),
    DimBlade(30.0, WS281XBladePtr<6, blade2Pin, Color8::GRB, PowerPINS<bladePowerPin4>>()),
    CONFIGARRAY(presets)
  },

    // Charging Override  
  { CHARGE_MODE,  
    SimpleBladePtr<CreeXPE2RedTemplate<5600>, CreeXPE2GreenTemplate<3900>, CreeXPE2BlueTemplate<3600>, NoLED, bladePowerPin1, bladePowerPin2, bladePowerPin3, -1>(),
    DimBlade(30.0, WS281XBladePtr<6, blade2Pin, Color8::GRB, PowerPINS<bladePowerPin4>>()),
    CONFIGARRAY(charge_detect_presets), "charge_save"
  },
};
#endif

#ifdef CONFIG_BUTTONS
Button PowerButton(BUTTON_POWER, powerButtonPin, "pow");
#endif
