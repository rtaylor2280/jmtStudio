// Custom and Reusable Styles

/*--------------------------------- AccentStaticRainbowFireFastBaseColor -------------------------
copyright Fett263 RainbowBlade (Accent LED / PCB) OS7 Style
https://www.fett263.com/fett263-proffieOS7-style-library.html#RainbowBlade
OS7.14 v3.25p
Single Style
Style Option
Off Behavior: Fast Color Rotate [Color: OffColorArg]


--Effects Included--
Ignition Effect: Instant [Color: IgnitionColorArg]
Retraction Effect: Instant [Color: RetractionColorArg]
Lockup Effect: NoneLightning Block Effect: NoneDrag Effect:
0: accentDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: accentMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Battery Level: Full Blade (Green to Red)
Power Save: 25% Increment */
using AccentStaticRainbowFireFastBaseColor = Layers<StyleFire<Gradient<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RotateColorsX<Int<5461>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RotateColorsX<Int<10922>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RotateColorsX<Int<16384>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RotateColorsX<Int<21845>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RotateColorsX<Int<27306>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>>,Mix<Int<16384>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,0,4>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,31000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,26000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,26000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrInstant,TrInstant,RotateColorsX<Saw<Int<5>>,Red>>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>>;
/*
Add to preset as StylePtr<AccentStaticRainbowFireFastBaseColor>()
--------------------------------------------------------------------------*/
/*--------------------------------- PixelSwitchStandard -------------------------
copyright Fett263 CustomBlade (Accent LED / PCB) OS7 Style
https://fett263library.com/early-access/#CustomBlade
OS7.14 v3.01p
Single Style
Interactive Clash Instability
Default: Static [BaseColorArg]
1: AudioFlicker (Single Color (75%)) [BaseColorArg]

Off Behavior: Slow Pulse Dim-On [Color: Match ON Color]
Each Clash or Lockup with apply Style 2 (Instability) in increasing levels based on strength of the clash, allowing time to pass between clashes allows the blade to re-stabilize. (approx 5 seconds)

--Effects Included--

Effect Reaction: AudioFlicker, BaseColorArg, Type: Centered, Direction: Normal, Duration: 3000, Consecutive Effects to Max: 3
Effect Reactions: Clash, BlastIgnition Effect: Center Out + Fade [Color: IgnitionColorArg]
PowerUp Effect: Power Flash [Color: IgnitionColorArg]
Retraction Effect: SparkTip Center In [Color: RetractionColorArg]
Lockup Effect: NoneLightning Block Effect:
0: accentLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: accentDragMulti0Shape - Begin: Full Blade Flash - Style: Unstable Flicker - End: Absorb
[Color: BaseColorArg]
Melt Effect:
0: accentMeltMulti0Shape - Begin: Power Burst - Style: Original Melt - End: Absorb
[Color: BaseColorArg]
Blast Effect: Blast Wave Up (Sound Based) [Color: BlastColorArg]
Swing Effect: Force Slow [Color: SwingColorArg]
Rain Effect: Rain Spark
Battery Level: Full Blade (Green to Red)
Power Save: 50% Toggle */
using PixelSwitchStandard = Layers<Mix<HoldPeakF<IncrementWithReset<Sum<EffectPulseF<EFFECT_CLASH>,EffectPulseF<EFFECT_LOCKUP_BEGIN>>,ThresholdPulseF<IncrementWithReset<ThresholdPulseF<BlinkingF<Int<1000>,Int<500>>,Int<32000>>,Sum<EffectPulseF<EFFECT_CLASH>,EffectPulseF<EFFECT_LOCKUP_BEGIN>>,Int<32768>,Int<8000>>,Int<32000>>,Int<32768>,Scale<ClashImpactF<>,Int<2000>,Int<8000>>>,Int<2000>,Int<10000>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,AudioFlicker<Mix<Int<3000>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,White>,Mix<Int<24576>,Black,Mix<Int<3000>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,White>>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrFade<300>>,Pulsing<RgbArg<SWING_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<SWING_COLOR_ARG,Rgb<255,255,255>>>,3000>,TrFade<300>>,EFFECT_FORCE>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<IgnitionTime<0>>,TrInstant>,RgbArg<IGNITION_COLOR_ARG,Rgb<255,255,255>>,TrFade<1000>>,EFFECT_IGNITION>,SparkleL<Mix<Int<1000>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,White>>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<WavLen<>,Int<100>,Int<400>>,Int<100>,Scale<WavLen<>,Int<100>,Int<400>>,Int<0>>,EFFECT_BLAST>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,LockupTrL<RandomPerLEDFlicker<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,BrownNoiseFlicker<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<8164>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,300>>,TrConcat<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,TrFade<300>>,TrFade<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<HumpFlicker<Mix<Int<7440>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,White>,RotateColorsX<Int<3000>,Mix<Int<7440>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,White>>,100>,TrWaveX<Mix<Int<7440>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,White>,Int<200>,Int<100>,Int<200>,Int<32768>>,TrFade<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrJoinR<TrCenterWipeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>,Int<16384>>,TrSmoothFadeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>>,TrCenterWipeInSparkX<RgbArg<RETRACTION_COLOR_ARG,Rgb<255,255,255>>,RetractionTime<0>,Int<16384>>,Pulsing<Mix<Int<8192>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,8000>>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>>;
/*
Add to preset as StylePtr<PixelSwitchStandard>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainHyperResponsiveRotoscopePrequelsBaseColor -------------------------
copyright Fett263 Rotoscope (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Rotoscope
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Stab Effect: AudioFlicker Stab [Color: StabColorArg]
Blast Effect: Responsive Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainHyperResponsiveRotoscopePrequelsBaseColor = Layers<Mix<HoldPeakF<SwingSpeed<250>,Scale<SwingAcceleration<100>,Int<50>,Int<500>>,Scale<SwingAcceleration<>,Int<20000>,Int<10000>>>,RandomFlicker<StripesX<Int<24000>,Scale<HoldPeakF<SwingSpeed<200>,Scale<SwingAcceleration<100>,Int<50>,Int<300>>,Scale<SwingAcceleration<100>,Int<24000>,Int<16000>>>,Int<-1400>,Int<-100>>,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>>,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,Mix<Int<19276>,Black,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>>>,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>>,RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<AudioFlickerL<RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<BladeAngle<>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<118,0,194>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainHyperResponsiveRotoscopePrequelsBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainHyperResponsiveRotoscopeVader -------------------------
copyright Fett263 Rotoscope (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Rotoscope
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Stab Effect: Sparking Stab [Color: ClashColorArg]
Blast Effect: Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainHyperResponsiveRotoscopeVader = Layers<Mix<HoldPeakF<SwingSpeed<250>,Scale<SwingAcceleration<100>,Int<50>,Int<500>>,Scale<SwingAcceleration<>,Int<20000>,Int<10000>>>,RandomFlicker<StripesX<Int<15000>,Scale<HoldPeakF<SwingSpeed<200>,Scale<SwingAcceleration<100>,Int<50>,Int<300>>,Scale<SwingAcceleration<100>,Int<24000>,Int<16000>>>,Int<-3200>,Int<-200>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Mix<Int<19276>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<RandomPerLEDFlickerL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<1100>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainHyperResponsiveRotoscopeVader>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainRotoscopeSingleColorOriginalTrilogyBaseColor -------------------------
copyright Fett263 Rotoscope (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Rotoscope
OS7.15 v4.11
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect (Randomly Selected): Responsive Blast Wave (Sound Based), Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainRotoscopeSingleColorOriginalTrilogyBaseColor = Layers<RandomFlicker<Stripes<10000,-2600,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<16448>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>,TransitionEffectL<TrRandom<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<WavLen<>,Int<100>,Int<400>>,Int<100>,Scale<WavLen<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<400>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainRotoscopeSingleColorOriginalTrilogyBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainResponsiveFlameRealFlameGradientBaseColor -------------------------
copyright Fett263 ResponsiveFlame (Primary Blade) OS7 Style
https://fett263library.com/early-access/#ResponsiveFlame
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity Flame - End: Full Blade Absorb
[Color: StabColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Unstable Flicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Fire Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Stab Effect: Sparking Stab [Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainResponsiveFlameRealFlameGradientBaseColor = Mix<SmoothStep<Scale<IsLessThan<BladeAngle<>,Int<16000>>,Int<36000>,Scale<BladeAngle<>,Int<10924>,Int<54000>>>,Scale<IsLessThan<BladeAngle<>,Int<16000>>,Int<-1>,Scale<BladeAngle<>,Int<-10000>,Int<-1>>>>,Black,Remap<Scale<RampF,Int<0>,Scale<IsLessThan<BladeAngle<>,Int<15000>>,Int<32768>,Scale<BladeAngle<0,15000>,Int<60000>,Int<32768>>>>,Layers<Mix<BladeAngle<>,StaticFire<Gradient<RotateColorsX<Int<1600>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RotateColorsX<Int<1000>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RotateColorsX<Int<400>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,Mix<Int<16384>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,0,2,0,1800,10>,StaticFire<Gradient<RotateColorsX<Int<1600>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RotateColorsX<Int<1200>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RotateColorsX<Int<600>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,Mix<Int<16384>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,0,4,0,2200,2>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<RandomPerLEDFlickerL<RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,97,0>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<Remap<CenterDistF<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,Stripes<3600,-1600,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Scale<SlowNoise<Int<1600>>,Int<4000>,Int<20000>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Scale<SlowNoise<Int<2000>>,Int<16000>,Int<2000>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<Remap<CenterDistF<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,Stripes<4200,-1200,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Scale<SlowNoise<Int<1600>>,Int<4000>,Int<20000>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Scale<SlowNoise<Int<2000>>,Int<16000>,Int<2000>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,AlphaL<RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<BrownNoiseFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Int<8000>>,300>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<Stripes<2000,3000,RgbArg<DRAG_COLOR_ARG,Rgb<255,97,0>>,Mix<Sin<Int<30>>,Black,RgbArg<DRAG_COLOR_ARG,Rgb<255,97,0>>>,Mix<Int<8192>,Black,RgbArg<DRAG_COLOR_ARG,Rgb<255,97,0>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>>>;
/*
Add to preset as StylePtr<MainResponsiveFlameRealFlameGradientBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainInteractiveWaterBladeBaseColor -------------------------
copyright Fett263 WaterBlade (Primary Blade) OS7 Style
https://fett263library.com/early-access/#WaterBlade
OS7.14 v4.102
Single Style
Style OptionInteractive Water Blade Interactive Control: Water flows based on blade angle, hard swing upward can temporarily change direction of flow.

--Effects Included--
Ignition Effect: Gravity Ignition [Color: IgnitionColorArg]
Retraction Effect: Gravity Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: AudioFlicker - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Absorb
[Color: StabColorArg]
Stab Effect: Normal Stab [Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainInteractiveWaterBladeBaseColor = Layers<StripesX<Scale<IsLessThan<BladeAngle<>,Int<16384>>,Scale<BladeAngle<>,Int<20000>,Int<10000>>,Scale<BladeAngle<>,Int<10000>,Int<20000>>>,Scale<BladeAngle<>,Int<-1000>,Scale<IsGreaterThan<HoldPeakF<SwingAcceleration<>,Scale<HoldPeakF<SwingAcceleration<>,Int<200>,Int<4000>>,Int<100>,Int<600>>,Scale<BladeAngle<>,Int<3000>,Int<6000>>>,Int<16384>>,Int<1000>,Int<-1000>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,135,255>>,Mix<Int<16384>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,135,255>>>,Mix<Int<10280>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,135,255>>>,Mix<Int<25700>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,135,255>>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,135,255>>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<0,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<0,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<0,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<0,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<AudioFlicker<RgbArg<DRAG_COLOR_ARG,Rgb<0,255,255>>,Mix<Int<8164>,Black,RgbArg<DRAG_COLOR_ARG,Rgb<0,255,255>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<30,60,200>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrFade<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrSelect<Scale<IsLessThan<BladeAngle<>,Int<18384>>,Scale<IsGreaterThan<SwingAcceleration<>,Int<16384>>,Int<0>,Int<2>>,Int<1>>,TrWipeInX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipe<100>>,TrSelect<Scale<IsLessThan<BladeAngle<>,Int<18384>>,Int<0>,Int<1>>,TrWipeInX<BendTimePowX<RetractionTime<300>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeX<BendTimePowX<RetractionTime<300>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,135,255>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainInteractiveWaterBladeBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- GreyscaleFontsSkotos -------------------------*/
using GreyscaleFontsSkotos = Layers<

  //Base Fett263 Violet Audioflicker
  AudioFlicker<RotateColorsX<Variation,Rgb<135,0,255>>,RotateColorsX<Variation,Rgb<67,0,115>>>,
  
  //Deep Violet HumpFlicker Swing Effect
  AlphaL<HumpFlicker<RotateColorsX<Variation,Rgb<175,0,255>>,RotateColorsX<Variation,Rgb<97,0,135>>,20>,SwingSpeed<375>>,
  
  //Fett263 Unstable Charge-Up Ignition
  TransitionEffectL<TrConcat<TrInstant,Stripes<3000,-1550,White,RandomPerLEDFlicker<Rgb<60,60,60>,Black>,BrownNoiseFlicker<White,Rgb<30,30,30>,200>,RandomPerLEDFlicker<Rgb<80,80,80>,Rgb<30,30,30>>>,TrFadeX<Percentage<WavLen<EFFECT_IGNITION>,20>>,Stripes<3000,-1550,White,RandomPerLEDFlicker<Rgb<60,60,60>,Black>,BrownNoiseFlicker<White,Rgb<30,30,30>,200>,RandomPerLEDFlicker<Rgb<80,80,80>,Rgb<30,30,30>>>,TrFadeX<Percentage<WavLen<EFFECT_IGNITION>,10>>,RotateColorsX<Variation,Magenta>,TrFadeX<Percentage<WavLen<EFFECT_IGNITION>,45>>>,EFFECT_IGNITION>,
  
  //HumpFlicker Bright Retraction
  TransitionEffectL<TrConcat<TrFadeX<WavLen<EFFECT_RETRACTION>>,HumpFlicker<RotateColorsX<Variation,Rgb16<65535,42753,65535>>,RotateColorsX<Variation,White>,50>,TrInstant>,EFFECT_RETRACTION>,
  
  //Fett263 Responsive Intensity Lockup with Unstable End
  LockupTrL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>,BrownNoiseFlickerL<RgbArg<LOCKUP_COLOR_ARG,White>,Int<200>>,StripesX<Int<1800>,Scale<NoisySoundLevel,Int<-3500>,Int<-5000>>,Mix<Int<6425>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>,RgbArg<LOCKUP_COLOR_ARG,White>,Mix<Int<12850>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>>>,
  TrConcat<TrExtend<50,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,White>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,White>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrExtend<3000,TrFade<300>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,White>,Mix<Int<10280>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Int<13000>>>,TrFade<3000>>,
  TrConcat<TrInstant,White,TrFade<500>,BrownNoiseFlicker<RotateColorsX<Variation,Magenta>,Black,300>,TrFadeX<Percentage<WavLen<EFFECT_LOCKUP_END>,33>>,AudioFlickerL<BrownNoiseFlicker<RotateColorsX<Variation,DeepPink>,Black,300>>,TrFadeX<Percentage<WavLen<EFFECT_LOCKUP_END>,33>>>,SaberBase::LOCKUP_NORMAL>,
  
  //Fett263 Responsive Lightning Block
  ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,White>,AudioFlicker<RgbArg<LB_COLOR_ARG,White>,Blue>,50,1>,TrConcat<TrInstant,AlphaL<RgbArg<LB_COLOR_ARG,White>,Bump<Int<12000>,Int<18000>>>,TrFade<200>>,TrConcat<TrInstant,HumpFlickerL<AlphaL<RgbArg<LB_COLOR_ARG,White>,Int<16000>>,30>,TrSmoothFade<600>>>,

  //Responsive Stab
  ResponsiveStabL<AudioFlickerL<RgbArg<STAB_COLOR_ARG,Yellow>>,TrWipeInX<Percentage<WavLen<EFFECT_STAB>,50>>,TrFadeX<Percentage<WavLen<EFFECT_STAB>,50>>>,
  
  //Fett263 Multi-blast, blaster reflect cycles through different responsive effects
  EffectSequence<EFFECT_BLAST,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Int<400>,Scale<SwingSpeed<200>,Int<100>,Int<400>>,Int<400>>,LocalizedClashL<RgbArg<BLAST_COLOR_ARG,White>,80,30,EFFECT_BLAST>,ResponsiveBlastWaveL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,BlastL<RgbArg<BLAST_COLOR_ARG,White>,200,200>,ResponsiveBlastFadeL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<6000>,Int<12000>>,Scale<SwingSpeed<400>,Int<400>,Int<100>>>,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<400>,Int<100>>,Scale<SwingSpeed<400>,Int<200>,Int<100>>,Scale<SwingSpeed<400>,Int<400>,Int<200>>>>,
  
  //Fett263 Real Clash
  Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,
  
  //Fett263 Intensity Drag
  LockupTrL<AlphaL<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,White>>,SmoothStep<IntArg<DRAG_SIZE_ARG,27500>,Int<5000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,White>,Int<300>>,SmoothStep<IntArg<DRAG_SIZE_ARG,29250>,Int<5000>>>,TrFade<4000>>,TrFade<300>,SaberBase::LOCKUP_DRAG>,
  
  //Fett263 Responsive Intensity Melt
  LockupTrL<AlphaL<Remap<Scale<RampF,Int<65536>,Int<0>>,StaticFire<Mix<TwistAngle<>,OrangeRed,DarkOrange>,Mix<TwistAngle<>,OrangeRed,Orange>,0,3,5,3000,10>>,SmoothStep<IntArg<MELT_SIZE_ARG,26000>,Int<6000>>>,TrConcat<TrWipeIn<100>,AlphaL<Red,SmoothStep<Int<29000>,Int<8000>>>,TrExtend<2000,TrFade<300>>,AlphaL<Mix<TwistAngle<>,Red,Orange>,SmoothStep<Int<29000>,Int<8000>>>,TrFade<3000>>,TrFade<250>,SaberBase::LOCKUP_MELT>,
  
  //Fett263 Power Save, if using his prop file hold Aux and click PWR while ON (pointing up) to dim blade in 25% increments.
  EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,

  //Fett263 Spark Tip Ignition and Retraction
  InOutTrL<TrJoin<TrWipeX<Percentage<WavLen<EFFECT_IGNITION>,30>>,TrSparkX<White,Int<400>,Percentage<WavLen<EFFECT_IGNITION>,30>,Int<0>>>,TrJoin<TrWipeInX<WavLen<EFFECT_RETRACTION>>,TrSparkX<White,Int<400>,WavLen<EFFECT_RETRACTION>,Int<32768>>>>,

  //Fett263 optional/alternate Passive Battery Monitor: on boot (1st line) or font change (2nd line) you will get a visual indicator at the emitter of your current battery level. This also works without a blade if you have a lit emitter or blade plug. Green is Full, Red is Low (the color will blend from Green to Red as the battery is depleted), the indicator will fade out after 3000 ms and not display again until powered down and back up or fonts change.
  //TransitionEffectL<TrConcat<TrDelay<1500>,Black,TrFade<1000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_BOOT>,
  //TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_NEWFONT>,
  
  //Fett263 On-Demand Battery Level: if using Fett263's prop file Hold AUX and click PWR while OFF, the battery level is represented by the location on the blade; tip = full, hilt = low and color; green = full, yellow = half, red = low
  TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrDelay<2000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<1000>>,EFFECT_BATTERY_LEVEL>,
  
  //False Start Preon
  TransitionEffectL<TrConcat<TrInstant,Black,TrWaveX<RotateColorsX<Variation,Rgb<135,0,255>>,Int<1750>,Int<175>,Int<1575>,Int<-3000>>,Black,TrInstant>,EFFECT_PREON>,
  
  //Ripple Out Preon
  TransitionEffectL<TrConcat<TrDelayX<Percentage<WavLen<EFFECT_PREON>,43>>,TransitionLoopL<TrWaveX<RotateColorsX<Variation,Rgb16<37981,16439,65535>>,Int<525>,Int<350>,Int<715>,Int<0>>>,TrFadeX<Percentage<WavLen<EFFECT_PREON>,55>>>,EFFECT_PREON>,
  
  //Noise Responsive Charge Up Preon
  TransitionEffectL<TrConcat<TrDelayX<Percentage<WavLen<EFFECT_PREON>,14>>,AlphaL<BrownNoiseFlicker<Black,RotateColorsX<Variation,Rgb16<65535,42753,65535>>,150>,SmoothStep<Scale<NoisySoundLevel,Int<-1500>,Trigger<EFFECT_PREON,WavLen<EFFECT_PREON>,Int<0>,Int<0>>>,Int<-9500>>>,TrDelayX<Percentage<WavLen<EFFECT_PREON>,86>>>,EFFECT_PREON>,
  
EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
TransitionEffectL<TrConcat<
  TrJoin<TrDelay<2000>, TrInstant>,
  AlphaL<Mix<BatteryLevel, Red, Green>, Bump<BatteryLevel, Int<10000>>>,
  TrFade<300>>, EFFECT_BATTERY_LEVEL>,
TransitionEffectL<TrConcat<
  TrExtend<2000, TrWipe<100>>,
  AlphaL<Rgb16<17219,0,29555>, SmoothStep<VolumeLevel, Int<-1>>>,
  TrFade<300>>, EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<GreyscaleFontsSkotos>()
--------------------------------------------------------------------------*/

/*--------------------------------- GreyscaleFontsDefect -------------------------*/
using GreyscaleFontsDefect = Layers<
	
  //Fett263 HumpFlicker with Erratic Swing
  Mix<SwingSpeed<400>,HumpFlicker<RotateColorsX<Variation,Red>,RotateColorsX<Variation,Rgb<128,0,0>>,50>,HumpFlicker<RotateColorsX<Variation,DarkOrange>,RotateColorsX<Variation,Rgb<128,0,0>>,30>>,
  
  //Ripple swing effect using Fett263's scaled responsive swing
  AlphaL<AlphaL<Stripes<2000,-2250,RotateColorsX<Variation,DarkOrange>,RotateColorsX<Variation,Rgb<60,30,0>>,Pulsing<RotateColorsX<Variation,Rgb<30,15,0>>,Black,800>>,HoldPeakF<Scale<IsLessThan<SwingSpeed<850>,Int<13600>>,Scale<SwingSpeed<850>,Int<-19300>,Int<32768>>,Int<0>>,Int<550>,Scale<SwingAcceleration<100>,Int<20000>,Int<10000>>>>,SmoothStep<Scale<Scale<IsLessThan<SwingSpeed<600>,Int<13600>>,Scale<SwingSpeed<600>,Int<-19300>,Int<32768>>,Int<0>>,Int<15000>,Int<5000>>,Int<-16000>>>, 
  
  //Fett263 Unstable Ignition
  TransitionEffectL<TrConcat<TrInstant,Stripes<3000,-1550,White,RandomPerLEDFlicker<Rgb<60,60,60>,Black>,BrownNoiseFlicker<White,Rgb<30,30,30>,200>,RandomPerLEDFlicker<Rgb<80,80,80>,Rgb<30,30,30>>>,TrFadeX<Percentage<WavLen<EFFECT_IGNITION>,15>>>,EFFECT_IGNITION>,
  
  //HumpFlicker Bright Retraction
  TransitionEffectL<TrConcat<TrFadeX<WavLen<EFFECT_RETRACTION>>,HumpFlicker<RotateColorsX<Variation,Rgb16<65535,42753,42753>>,RotateColorsX<Variation,White>,50>,TrInstant>,EFFECT_RETRACTION>,
  
  //Fett263 Responsive Intensity Lockup with Unstable End
  LockupTrL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>,BrownNoiseFlickerL<RgbArg<LOCKUP_COLOR_ARG,White>,Int<200>>,StripesX<Int<1800>,Scale<NoisySoundLevel,Int<-3500>,Int<-5000>>,Mix<Int<6425>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>,RgbArg<LOCKUP_COLOR_ARG,White>,Mix<Int<12850>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>>>,
  TrConcat<TrExtend<50,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,White>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,White>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrExtend<3000,TrFade<300>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,White>,Mix<Int<10280>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Int<13000>>>,TrFade<3000>>,
  TrConcat<TrInstant,White,TrFade<650>,BrownNoiseFlicker<RotateColorsX<Variation,Rgb16<65535,11439,0>>,Black,300>,TrFade<1000>,AudioFlickerL<BrownNoiseFlicker<RotateColorsX<Variation,Red>,Black,300>>,TrFade<1200>>,SaberBase::LOCKUP_NORMAL>,
  
  //Fett263 Responsive Lightning Block
  ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,White>,AudioFlicker<RgbArg<LB_COLOR_ARG,White>,Blue>,50,1>,TrConcat<TrInstant,AlphaL<RgbArg<LB_COLOR_ARG,White>,Bump<Int<12000>,Int<18000>>>,TrFade<200>>,TrConcat<TrInstant,HumpFlickerL<AlphaL<RgbArg<LB_COLOR_ARG,White>,Int<16000>>,30>,TrSmoothFade<600>>>,
  
  //Fett263 Responsive flame emitter effect, point the blade up to speed up the flame
  AlphaL<Mix<Scale<BladeAngle<19000>,Int<32768>,Int<0>>,StyleFire<Gradient<RotateColorsX<Variation,White>,RotateColorsX<Variation,Rgb16<65535,42753,42753>>,RotateColorsX<Variation,Rgb16<65535,42753,42753>>,RotateColorsX<Variation,Rgb16<65535,42753,42753>>>,RotateColorsX<Variation,Rgb<30,30,30>>,0,2,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>>,StyleFire<Gradient<RotateColorsX<Variation,Rgb16<65535,42753,42753>>,RotateColorsX<Variation,White>,RotateColorsX<Variation,White>,RotateColorsX<Variation,White>>,RotateColorsX<Variation,Rgb<30,30,30>>,0,1,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>>>,SmoothStep<Scale<SlowNoise<Int<3000>>,Int<1750>,Int<4125>>,Int<-3500>>>,
  
  //Responsive Stab
  ResponsiveStabL<AudioFlickerL<RgbArg<STAB_COLOR_ARG,Yellow>>,TrWipeInX<Percentage<WavLen<EFFECT_STAB>,50>>,TrFadeX<Percentage<WavLen<EFFECT_STAB>,50>>>,
  
  //Fett263 Multi-blast, blaster reflect cycles through different responsive effects
  EffectSequence<EFFECT_BLAST,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Int<400>,Scale<SwingSpeed<200>,Int<100>,Int<400>>,Int<400>>,LocalizedClashL<RgbArg<BLAST_COLOR_ARG,White>,80,30,EFFECT_BLAST>,ResponsiveBlastWaveL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,BlastL<RgbArg<BLAST_COLOR_ARG,White>,200,200>,ResponsiveBlastFadeL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<6000>,Int<12000>>,Scale<SwingSpeed<400>,Int<400>,Int<100>>>,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<400>,Int<100>>,Scale<SwingSpeed<400>,Int<200>,Int<100>>,Scale<SwingSpeed<400>,Int<400>,Int<200>>>>,
  
  //Fett263 Real Clash
  Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,
  
  //Fett263 Intensity Drag
  LockupTrL<AlphaL<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,White>>,SmoothStep<IntArg<DRAG_SIZE_ARG,27500>,Int<5000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,White>,Int<300>>,SmoothStep<IntArg<DRAG_SIZE_ARG,29250>,Int<5000>>>,TrFade<4000>>,TrFade<300>,SaberBase::LOCKUP_DRAG>,
  
  //Fett263 Responsive Intensity Melt
  LockupTrL<AlphaL<Remap<Scale<RampF,Int<65536>,Int<0>>,StaticFire<Mix<TwistAngle<>,OrangeRed,DarkOrange>,Mix<TwistAngle<>,OrangeRed,Orange>,0,3,5,3000,10>>,SmoothStep<IntArg<MELT_SIZE_ARG,26000>,Int<6000>>>,TrConcat<TrWipeIn<100>,AlphaL<Red,SmoothStep<Int<29000>,Int<8000>>>,TrExtend<2000,TrFade<300>>,AlphaL<Mix<TwistAngle<>,Red,Orange>,SmoothStep<Int<29000>,Int<8000>>>,TrFade<3000>>,TrFade<250>,SaberBase::LOCKUP_MELT>,
  
  //Fett263 Power Save, if using his prop file hold Aux and click PWR while ON (pointing up) to dim blade in 25% increments.
  EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,

  //Fett263 Spark Tip Ignition and Retraction
  InOutTrL<TrJoin<TrWipeX<Percentage<WavLen<EFFECT_IGNITION>,5>>,TrSparkX<White,Int<400>,Percentage<WavLen<EFFECT_IGNITION>,5>,Int<0>>>,TrJoin<TrWipeInX<WavLen<EFFECT_RETRACTION>>,TrSparkX<White,Int<400>,WavLen<EFFECT_RETRACTION>,Int<32768>>>>,
  
  //Noise Responsive Sparky Hilt Postoff
  TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlicker<Black,RotateColorsX<Variation,Rgb16<65535,42753,42753>>,150>,SmoothStep<Scale<NoisySoundLevel,Int<-1000>,Int<9500>>,Int<-7000>>>,TrFadeX<WavLen<EFFECT_POSTOFF>>>,EFFECT_POSTOFF>,
  
  //Fett263 optional/alternate Passive Battery Monitor: on boot (1st line) or font change (2nd line) you will get a visual indicator at the emitter of your current battery level. This also works without a blade if you have a lit emitter or blade plug. Green is Full, Red is Low (the color will blend from Green to Red as the battery is depleted), the indicator will fade out after 3000 ms and not display again until powered down and back up or fonts change.
  //TransitionEffectL<TrConcat<TrDelay<1500>,Black,TrFade<1000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_BOOT>,
  //TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_NEWFONT>,
  
  //Fett263 On-Demand Battery Level: if using Fett263's prop file Hold AUX and click PWR while OFF, the battery level is represented by the location on the blade; tip = full, hilt = low and color; green = full, yellow = half, red = low
  TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrDelay<2000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<1000>>,EFFECT_BATTERY_LEVEL>,
  
  //Ripple Out Preon
  TransitionEffectL<TrConcat<TrFadeX<Percentage<WavLen<EFFECT_PREON>,10>>,TransitionLoopL<TrWaveX<RotateColorsX<Variation,Rgb16<65535,42753,42753>>,Int<125>,Int<350>,Int<315>,Int<0>>>,TrDelayX<Percentage<WavLen<EFFECT_PREON>,90>>>,EFFECT_PREON>,
  
  //Noise Responsive Charge Up Preon
  TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlicker<Black,RotateColorsX<Variation,Rgb16<65535,42753,42753>>,150>,SmoothStep<Scale<NoisySoundLevel,Int<-1500>,Trigger<EFFECT_PREON,WavLen<EFFECT_PREON>,Int<0>,Int<0>>>,Int<-8000>>>,TrDelayX<WavLen<EFFECT_PREON>>>,EFFECT_PREON>,
  
EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
TransitionEffectL<TrConcat<
  TrJoin<TrDelay<2000>, TrInstant>,
  AlphaL<Mix<BatteryLevel, Red, Green>, Bump<BatteryLevel, Int<10000>>>,
  TrFade<300>>, EFFECT_BATTERY_LEVEL>,
TransitionEffectL<TrConcat<
  TrExtend<2000, TrWipe<100>>,
  AlphaL<Rgb16<65535,0,0>, SmoothStep<VolumeLevel, Int<-1>>>,
  TrFade<300>>, EFFECT_VOLUME_LEVEL>>; 
/*
Add to preset as StylePtr<GreyscaleFontsDefect>()
--------------------------------------------------------------------------*/  

/*--------------------------------- GreyscaleFontsBinary_Light -------------------------*/  
using GreyscaleFontsBinary_Light = Layers<
	
  //Force effect toggles between Red and Deep Sky Blue. You can still use the color wheel to try out other colors paired together or edit the colors below yourself.
  EffectSequence<EFFECT_FORCE,
  
  //Deep Sky Blue
  Layers<
  
        //Fett263 Humpflicker
	HumpFlicker<RotateColorsX<Variation,DeepSkyBlue>,RotateColorsX<Variation,Rgb<0,50,120>>,50>,
    
	//Fett263 unstable swing
	AlphaL<AudioFlickerL<Stripes<1000,-1500,RandomPerLEDFlicker<RotateColorsX<Variation,Cyan>,Black>,Black,RotateColorsX<Variation,DeepSkyBlue>,Black>>,SwingSpeed<350>>,
    
	//Ripple swing effect using Fett263's scaled responsive swing
	AlphaL<AlphaL<Stripes<2000,-2250,RotateColorsX<Variation,Cyan>,RotateColorsX<Variation,Rgb<0,50,40>>,Pulsing<RotateColorsX<Variation,Rgb<0,35,20>>,Black,800>>,HoldPeakF<Scale<IsLessThan<SwingSpeed<850>,Int<13600>>,Scale<SwingSpeed<850>,Int<-19300>,Int<32768>>,Int<0>>,Int<550>,Scale<SwingAcceleration<100>,Int<20000>,Int<10000>>>>,SmoothStep<Scale<Scale<IsLessThan<SwingSpeed<600>,Int<13600>>,Scale<SwingSpeed<600>,Int<-19300>,Int<32768>>,Int<0>>,Int<15000>,Int<5000>>,Int<16000>>>,
    
	//Fett263 unstable ignition with slow fade from red to deep sky blue
	TransitionEffectL<TrConcat<TrInstant,Stripes<3000,-1550,White,RandomPerLEDFlicker<Rgb<60,60,60>,Black>,BrownNoiseFlicker<White,Rgb<30,30,30>,200>,RandomPerLEDFlicker<Rgb<80,80,80>,Rgb<30,30,30>>>,TrFade<3000>,HumpFlicker<RotateColorsX<Variation,Red>,RotateColorsX<Variation,Rgb<128,0,0>>,50>,TrDelay<5000>,HumpFlicker<RotateColorsX<Variation,Red>,RotateColorsX<Variation,Rgb<128,0,0>>,50>,TrFade<5000>>,EFFECT_IGNITION>>,
  
  //Red
  Layers<
    
	//Fett263 Humpflicker
        HumpFlicker<RotateColorsX<Variation,Red>,RotateColorsX<Variation,Rgb<128,0,0>>,50>,
    
	//Fett263 unstable swing
	AlphaL<AudioFlickerL<Stripes<1000,-1500,RandomPerLEDFlicker<RotateColorsX<Variation,DarkOrange>,Black>,Black,RotateColorsX<Variation,Red>,Black>>,SwingSpeed<350>>,
    
	//Ripple swing effect using Fett263's scaled responsive swing
	AlphaL<AlphaL<Stripes<2000,-2250,RotateColorsX<Variation,DarkOrange>,RotateColorsX<Variation,Rgb<60,30,0>>,Pulsing<RotateColorsX<Variation,Rgb<30,15,0>>,Black,800>>,HoldPeakF<Scale<IsLessThan<SwingSpeed<850>,Int<13600>>,Scale<SwingSpeed<850>,Int<-19300>,Int<32768>>,Int<0>>,Int<550>,Scale<SwingAcceleration<100>,Int<20000>,Int<10000>>>>,SmoothStep<Scale<Scale<IsLessThan<SwingSpeed<600>,Int<13600>>,Scale<SwingSpeed<600>,Int<-19300>,Int<32768>>,Int<0>>,Int<15000>,Int<5000>>,Int<16000>>>,
    
	//Fett263 unstable ignition with slow fade from deep sky blue to red
	TransitionEffectL<TrConcat<TrInstant,Stripes<3000,-1550,White,RandomPerLEDFlicker<Rgb<60,60,60>,Black>,BrownNoiseFlicker<White,Rgb<30,30,30>,200>,RandomPerLEDFlicker<Rgb<80,80,80>,Rgb<30,30,30>>>,TrFade<3000>,HumpFlicker<RotateColorsX<Variation,DeepSkyBlue>,RotateColorsX<Variation,Rgb<0,50,120>>,50>,TrDelay<5000>,HumpFlicker<RotateColorsX<Variation,DeepSkyBlue>,RotateColorsX<Variation,Rgb<0,50,120>>,50>,TrFade<5000>>,EFFECT_IGNITION>>>,
  
  //Fett263 unstable force effect with sizzle emitter ending - Toggles the base saber colors between red and blue.
  TransitionEffectL<TrConcat<TrInstant,White,TrFade<150>,StyleFire<Stripes<2500,-5000,BrownNoiseFlicker<RotateColorsX<Variation,Magenta>,Black,20>,RotateColorsX<Variation,Rgb<10,0,10>>,BrownNoiseFlicker<Black,RotateColorsX<Variation,Rgb<255,25,255>>,70>,RotateColorsX<Variation,Rgb<128,0,128>>>,RotateColorsX<Variation,Rgb<80,0,80>>,0,5,FireConfig<2,3000,0>,FireConfig<2,3000,0>,FireConfig<2,3000,0>,FireConfig<2,3000,0>>,TrDelay<1000>,StyleFire<Stripes<2500,-5000,BrownNoiseFlicker<RotateColorsX<Variation,Magenta>,Black,20>,RotateColorsX<Variation,Rgb<10,0,10>>,BrownNoiseFlicker<Black,RotateColorsX<Variation,Rgb<255,25,255>>,70>,RotateColorsX<Variation,Rgb<128,0,128>>>,RotateColorsX<Variation,Rgb<80,0,80>>,0,5,FireConfig<2,3000,0>,FireConfig<2,3000,0>,FireConfig<2,3000,0>,FireConfig<2,3000,0>>,TrFade<1000>,AlphaL<StyleFire<Stripes<2500,-5000,BrownNoiseFlicker<RotateColorsX<Variation,Magenta>,Black,20>,RotateColorsX<Variation,Rgb<10,0,10>>,BrownNoiseFlicker<Black,RotateColorsX<Variation,Rgb<255,25,255>>,70>,RotateColorsX<Variation,Rgb<128,0,128>>>,RotateColorsX<Variation,Rgb<80,0,80>>,0,5,FireConfig<2,3000,0>,FireConfig<2,3000,0>,FireConfig<2,3000,0>,FireConfig<2,3000,0>>,Bump<Int<3500>,Int<23384>>>,TrFade<600>>,EFFECT_FORCE>,
  
  //Fett263 Responsive Intensity Lockup effect with absorb endlock
  LockupTrL<TransitionEffect<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>,BrownNoiseFlickerL<RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Int<200>>,StripesX<Int<1800>,Scale<NoisySoundLevel,Int<-3500>,Int<-5000>>,Mix<Int<6425>,Black,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>>,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Mix<Int<12850>,Black,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Mix<Int<10280>,Black,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Int<13000>>>,TrJoin<TrDelay<8000>,TrInstant>,TrFade<3000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,AlphaL<RgbArg<LOCKUP_COLOR_ARG,White>,Int<0>>,TrWaveX<RgbArg<LOCKUP_COLOR_ARG,White>,Int<300>,Int<100>,Int<400>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,AlphaL<HumpFlicker<White,Rgb<40,60,60>,50>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>>,TrFade<350>>,SaberBase::LOCKUP_NORMAL>,
  
  //Fett263 Responsive Intensity Lockup effect
  //LockupTrL<TransitionEffect<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>,BrownNoiseFlickerL<RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Int<200>>,StripesX<Int<1800>,Scale<NoisySoundLevel,Int<-3500>,Int<-5000>>,Mix<Int<6425>,Black,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>>,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Mix<Int<12850>,Black,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Mix<Int<10280>,Black,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Int<13000>>>,TrJoin<TrDelay<8000>,TrInstant>,TrFade<3000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,NavajoWhite>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,AlphaL<RgbArg<LOCKUP_COLOR_ARG,White>,Int<0>>,TrWaveX<RgbArg<LOCKUP_COLOR_ARG,White>,Int<300>,Int<100>,Int<400>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>>,SaberBase::LOCKUP_NORMAL>,
  
  //Fett263 Responsive Lightning Block
  ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,White>,AudioFlicker<RgbArg<LB_COLOR_ARG,White>,Blue>,50,1>,TrConcat<TrInstant,AlphaL<RgbArg<LB_COLOR_ARG,White>,Bump<Int<12000>,Int<18000>>>,TrFade<200>>,TrConcat<TrInstant,HumpFlickerL<AlphaL<RgbArg<LB_COLOR_ARG,White>,Int<16000>>,30>,TrSmoothFade<600>>>,
  
  //Responsive Stab
  ResponsiveStabL<AudioFlickerL<RgbArg<STAB_COLOR_ARG,Yellow>>,TrWipeInX<Percentage<WavLen<EFFECT_STAB>,50>>,TrFadeX<Percentage<WavLen<EFFECT_STAB>,50>>>,
  
  //Blast selection based on absorb effect
  ColorSelect<WavNum<EFFECT_BLAST>,TrInstant,
    
	//Fett263 Responsive Blast Wave
    TransitionEffectL<TrConcat<TrInstant,ResponsiveBlastWaveL<White,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,TrDelay<500>>,EFFECT_BLAST>,
    
	//Fett263 Responsive Blast Wave with absorb effect
    TransitionEffectL<TrConcat<TrInstant,ResponsiveBlastWaveL<White,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,TrFade<500>,AlphaL<HumpFlicker<White,Rgb<40,60,60>,50>,Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>>>,TrFade<350>>,EFFECT_BLAST>>,
  
  //Fett263 Responsive Blast Wave
  //ResponsiveBlastWaveL<White,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,
  
  //OS6 Random Fett263 Responsive Multi-Blast
  //ColorSelect<RandomF,TrInstant,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Int<400>,Scale<SwingSpeed<200>,Int<100>,Int<400>>,Int<400>>,LocalizedClashL<RgbArg<BLAST_COLOR_ARG,White>,80,30,EFFECT_BLAST>,ResponsiveBlastWaveL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,BlastL<RgbArg<BLAST_COLOR_ARG,White>,200,200>,ResponsiveBlastFadeL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<6000>,Int<12000>>,Scale<SwingSpeed<400>,Int<400>,Int<100>>>,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<400>,Int<100>>,Scale<SwingSpeed<400>,Int<200>,Int<100>>,Scale<SwingSpeed<400>,Int<400>,Int<200>>>>,
  
  //OS6 Fett263 Random Responsive Blast
  //MultiTransitionEffectL<TrRandom<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaL<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Bump<Int<16384>,Int<6000>>>,TrFade<50>,AlphaL<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Int<0>>,TrSparkX<Remap<CenterDistF<EffectPosition<>>,Stripes<2000,-2000,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<2096>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>>,Int<100>,Int<300>,Scale<BladeAngle<>,Int<28000>,Int<8000>>>>,TrConcat<TrInstant,AlphaL<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Bump<Int<16384>,Int<6000>>>,TrFade<50>,AlphaL<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Int<0>>,TrWaveX<Remap<CenterDistF<EffectPosition<>>,Stripes<1500,-2000,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<2096>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>>,Int<160>,Int<100>,Int<300>,Scale<BladeAngle<>,Int<28000>,Int<8000>>>>,TrConcat<TrInstant,AlphaMixL<Bump<EffectPosition<>,Scale<WavLen<>,Int<9000>,Int<12000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>,TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<BladeAngle<>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>>,EFFECT_BLAST>,
  
  //OS5 Fett263 Multi-Blast, blaster reflect cycles through different responsive effects (I like the look of this one the best even with the new OS6 stuff)
  //EffectSequence<EFFECT_BLAST,ResponsiveBlastL<White,Int<400>,Scale<SwingSpeed<200>,Int<100>,Int<400>>,Int<400>>,LocalizedClashL<White,80,30,EFFECT_BLAST>,ResponsiveBlastWaveL<White,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,BlastL<White,200,200>,ResponsiveBlastFadeL<White,Scale<SwingSpeed<400>,Int<6000>,Int<12000>>,Scale<SwingSpeed<400>,Int<400>,Int<100>>>,ResponsiveBlastL<White,Scale<SwingSpeed<400>,Int<400>,Int<100>>,Scale<SwingSpeed<400>,Int<200>,Int<100>>,Scale<SwingSpeed<400>,Int<400>,Int<200>>>>,
  
  //Fett263 Real Clash with absorb effect
  Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,NavajoWhite>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<300>,Int<200>,Int<940>>>,AlphaL<HumpFlicker<White,Rgb<40,60,60>,50>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>>,TrFade<350>>,EFFECT_CLASH>,TransitionEffectL<TrConcat<TrWaveX<RgbArg<CLASH_COLOR_ARG,NavajoWhite>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,AlphaL<HumpFlicker<White,Rgb<40,60,60>,50>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>>,TrFade<350>>,EFFECT_CLASH>>,
  
  //Fett263 Real Clash
  //Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,

  //Fett263 Intensity Drag
  LockupTrL<AlphaL<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,White>>,SmoothStep<IntArg<DRAG_SIZE_ARG,27500>,Int<5000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,White>,Int<300>>,SmoothStep<IntArg<DRAG_SIZE_ARG,29250>,Int<5000>>>,TrFade<4000>>,TrFade<300>,SaberBase::LOCKUP_DRAG>,
    
  //Alternate Responsive Drag
  //LockupTrL<AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,White>,Int<300>>,SmoothStep<Int<30000>,Int<5000>>>,TrWipeInX<WavLen<EFFECT_DRAG_BEGIN>>,TrFadeX<WavLen<EFFECT_DRAG_END>>,SaberBase::LOCKUP_DRAG>,
  
  //Fett263 Responsive Intensity Melt
  LockupTrL<AlphaL<Remap<Scale<RampF,Int<65536>,Int<0>>,StaticFire<Mix<TwistAngle<>,OrangeRed,DarkOrange>,Mix<TwistAngle<>,OrangeRed,Orange>,0,3,5,3000,10>>,SmoothStep<IntArg<MELT_SIZE_ARG,26000>,Int<6000>>>,TrConcat<TrWipeIn<100>,AlphaL<Red,SmoothStep<Int<29000>,Int<8000>>>,TrExtend<2000,TrFade<300>>,AlphaL<Mix<TwistAngle<>,Red,Orange>,SmoothStep<Int<29000>,Int<8000>>>,TrFade<3000>>,TrFade<250>,SaberBase::LOCKUP_MELT>,
  
  //Fett263 Power Save, if using fett263's prop file hold Aux and click PWR while ON (pointing up) to dim blade in 25% increments.
  EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
  
  //Spark tip ignition and cycle down retraction
  InOutTrL<TrWipeSparkTip<White,1500>,TrColorCycleX<Int<500>,500>>,
  
  //Force effect toggles between red and deep sky blue
  EffectSequence<EFFECT_FORCE,
    
	//Deep sky blue glowing emitter retraction with fizzle out post off
	TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RotateColorsX<Variation,DeepSkyBlue>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<1500>>,Int<2000>,Int<4500>>,Int<-4000>>>,TrDelayX<WavLen<EFFECT_RETRACTION>>,Black,TrDelay<897>,AlphaL<RandomPerLEDFlicker<RotateColorsX<Variation,DeepSkyBlue>,Black>,Bump<Int<10500>,Int<11500>>>,TrDelay<150>>,EFFECT_RETRACTION>,
    
	//Red glowing emitter retraction with fizzle out post off
	TransitionEffectL<TrConcat<TrInstant,AlphaL<BrownNoiseFlickerL<RotateColorsX<Variation,Red>,Int<30>>,SmoothStep<Scale<SlowNoise<Int<1500>>,Int<2000>,Int<4500>>,Int<-4000>>>,TrDelayX<WavLen<EFFECT_RETRACTION>>,Black,TrDelay<897>,AlphaL<RandomPerLEDFlicker<RotateColorsX<Variation,Red>,Black>,Bump<Int<10500>,Int<11500>>>,TrDelay<150>>,EFFECT_RETRACTION>>,
  
  //Force effect toggles between red and deep sky blue
  EffectSequence<EFFECT_FORCE,
    
	//Unstable deep sky blue noise responsive post off
	TransitionEffectL<TrConcat<TrDelayX<WavLen<EFFECT_RETRACTION>>,AlphaL<BrownNoiseFlicker<Black,RotateColorsX<Variation,DeepSkyBlue>,125>,SmoothStep<Scale<NoisySoundLevel,Int<2500>,Int<15000>>,Int<-4000>>>,TrFadeX<WavLen<EFFECT_POSTOFF>>>,EFFECT_RETRACTION>,
    
	//Unstable red noise responsive post off
	TransitionEffectL<TrConcat<TrDelayX<WavLen<EFFECT_RETRACTION>>,AlphaL<BrownNoiseFlicker<Black,RotateColorsX<Variation,Red>,125>,SmoothStep<Scale<NoisySoundLevel,Int<2500>,Int<15000>>,Int<-4000>>>,TrFadeX<WavLen<EFFECT_POSTOFF>>>,EFFECT_RETRACTION>>,

  //Fett263 On-Demand Battery Level, if using fett263's prop file Hold AUX and click PWR while OFF, the battery level is represented by the location on the blade; tip = full, hilt = low and color; green = full, yellow = half, red = low
  TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrDelay<2000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<1000>>,EFFECT_BATTERY_LEVEL>,
  
  //Optional/alternate Fett263 Passive Battery Monitor (fett263 prop file not required), on boot (1st line) or font change (2nd line) you will get a visual indicator at the emitter of your current battery level. This also works without a blade if you have a lit emitter or blade plug. Green is Full, Red is Low (the color will blend from Green to Red as the battery is depleted), the indicator will fade out after 3000 ms and not display again until powered down and back up or fonts change.  
  //TransitionEffectL<TrConcat<TrDelay<1500>,Black,TrFade<1000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_BOOT>,
  //TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_NEWFONT>,

  //Force effect toggles between red and deep sky blue
  EffectSequence<EFFECT_FORCE,
    
	//Red false start preon
	TransitionEffectL<TrConcat<TrDelay<500>,Black,TrWaveX<RotateColorsX<Variation,Red>,Int<750>,Int<175>,Int<1575>,Int<-3000>>,Black,TrInstant,AlphaL<RandomPerLEDFlicker<RotateColorsX<Variation,Red>,Black>,Bump<Int<12000>,Int<11500>>>,TrDelay<150>>,EFFECT_PREON>,
    
	//Deep sky blue false start preon
	TransitionEffectL<TrConcat<TrDelay<500>,Black,TrWaveX<RotateColorsX<Variation,DeepSkyBlue>,Int<750>,Int<175>,Int<1575>,Int<-3000>>,Black,TrInstant,AlphaL<RandomPerLEDFlicker<RotateColorsX<Variation,DeepSkyBlue>,Black>,Bump<Int<12000>,Int<11500>>>,TrDelay<150>>,EFFECT_PREON>>,
  
  //Noise responsive sparking emitter preon
  TransitionEffectL<TrConcat<TrInstant,AlphaL<White,SmoothStep<Scale<NoisySoundLevel,Int<150>,Int<10000>>,Int<-4000>>>,TrDelayX<WavLen<>>>,EFFECT_PREON>,
  
EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
TransitionEffectL<TrConcat<
  TrJoin<TrDelay<2000>, TrInstant>,
  AlphaL<Mix<BatteryLevel, Red, Green>, Bump<BatteryLevel, Int<10000>>>,
  TrFade<300>>, EFFECT_BATTERY_LEVEL>,
TransitionEffectL<TrConcat<
  TrExtend<2000, TrWipe<100>>,
  AlphaL<Rgb16<8357,8357,20393>, SmoothStep<VolumeLevel, Int<-1>>>,
  TrFade<300>>, EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<GreyscaleFontsBinary_Light>()
--------------------------------------------------------------------------*/
  
/*--------------------------------- GreyscaleFontsNull -------------------------*/ 
using GreyscaleFontsNull = Layers<

  //'Heartbeat Pulse' (based on Fett263's Unstable Pulse Silver/Purple)
  StripesX<Int<10000>,Scale<SlowNoise<Int<50000>>,Int<-50>,Int<-1000>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,240>>,RandomPerLEDFlicker<Mix<Int<20000>,White,RgbArg<BASE_COLOR_ARG,Rgb<100,50,240>>>,Mix<Int<20000>,White,RgbArg<BASE_COLOR_ARG,Rgb<100,50,240>>>>,BrownNoiseFlicker<Mix<Int<1285>,White,RgbArg<BASE_COLOR_ARG,Rgb<100,50,240>>>,Mix<Int<16448>,White,RgbArg<BASE_COLOR_ARG,Rgb<100,50,240>>>,300>,RgbArg<BASE_COLOR_ARG,Rgb<100,50,240>>,RandomPerLEDFlicker<White,Mix<Int<16448>,White,RgbArg<BASE_COLOR_ARG,Rgb<100,100,240>>>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,240>>>,

  //Fett263 Silver Purple Humpflicker Swing
  AlphaL<HumpFlicker<RotateColorsX<Variation,Rgb16<64000,8000,0>>,RotateColorsX<Variation,Rgb16<12000,1818,0>>,50>,SwingSpeed<365>>,
  
  //Fett263 Responsive Intensity Lockup
  LockupTrL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>,BrownNoiseFlickerL<RgbArg<LOCKUP_COLOR_ARG,White>,Int<200>>,StripesX<Int<1800>,Scale<NoisySoundLevel,Int<-3500>,Int<-5000>>,Mix<Int<6425>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>,RgbArg<LOCKUP_COLOR_ARG,White>,Mix<Int<12850>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>>>,
  TrConcat<TrExtend<50,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,White>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,White>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrExtend<3000,TrFade<300>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,White>,Mix<Int<10280>,Black,RgbArg<LOCKUP_COLOR_ARG,White>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Int<13000>>>,TrFade<3000>>,
  TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,White>,TrFadeX<Percentage<WavLen<EFFECT_LOCKUP_END>,85>>>,SaberBase::LOCKUP_NORMAL>,
  
  //Fett263 Responsive Lightning Block
  ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,White>,AudioFlicker<RgbArg<LB_COLOR_ARG,White>,Blue>,50,1>,TrConcat<TrInstant,AlphaL<RgbArg<LB_COLOR_ARG,White>,Bump<Int<12000>,Int<18000>>>,TrFade<200>>,TrConcat<TrInstant,HumpFlickerL<AlphaL<RgbArg<LB_COLOR_ARG,White>,Int<16000>>,30>,TrSmoothFade<600>>>,
  
  //Responsive Stab
  ResponsiveStabL<AudioFlickerL<RgbArg<STAB_COLOR_ARG,Magenta>>,TrWipeInX<Percentage<WavLen<EFFECT_STAB>,50>>,TrFadeX<Percentage<WavLen<EFFECT_STAB>,50>>>,
  
  //Fett263 Multi-blast, blaster reflect cycles through different responsive effects
  EffectSequence<EFFECT_BLAST,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Int<400>,Scale<SwingSpeed<200>,Int<100>,Int<400>>,Int<400>>,LocalizedClashL<RgbArg<BLAST_COLOR_ARG,White>,80,30,EFFECT_BLAST>,ResponsiveBlastWaveL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,BlastL<RgbArg<BLAST_COLOR_ARG,White>,200,200>,ResponsiveBlastFadeL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<6000>,Int<12000>>,Scale<SwingSpeed<400>,Int<400>,Int<100>>>,ResponsiveBlastL<RgbArg<BLAST_COLOR_ARG,White>,Scale<SwingSpeed<400>,Int<400>,Int<100>>,Scale<SwingSpeed<400>,Int<200>,Int<100>>,Scale<SwingSpeed<400>,Int<400>,Int<200>>>>,
  
  //Fett263 Real Clash
  Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,187,108>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,
  
  //Fett263 White Unstable Ignition Effect
  TransitionEffectL<TrConcat<TrInstant,Stripes<3000,-2500,White,RandomPerLEDFlicker<Rgb<60,60,60>,Black>,BrownNoiseFlicker<White,Rgb<30,30,30>,200>,RandomPerLEDFlicker<Rgb<80,80,80>,Rgb<30,30,30>>>,TrFade<2950>>,EFFECT_IGNITION>,
  
  //Bright Humpflicker Retraction Effect
  TransitionEffectL<TrConcat<TrInstant,HumpFlicker<RotateColorsX<Variation,Rgb<125,85,175>>,RotateColorsX<Variation,Rgb16<24485,13179,65535>>,50>,TrFadeX<WavLen<EFFECT_RETRACTION>>>,EFFECT_RETRACTION>,
  
  //Fett263 Intensity Drag
  LockupTrL<AlphaL<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,White>>,SmoothStep<IntArg<DRAG_SIZE_ARG,27500>,Int<5000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,White>,Int<300>>,SmoothStep<IntArg<DRAG_SIZE_ARG,29250>,Int<5000>>>,TrFade<4000>>,TrFade<300>,SaberBase::LOCKUP_DRAG>,
  
  //Fett263 Responsive Intensity Melt
  LockupTrL<AlphaL<Remap<Scale<RampF,Int<65536>,Int<0>>,StaticFire<Mix<TwistAngle<>,OrangeRed,DarkOrange>,Mix<TwistAngle<>,OrangeRed,Orange>,0,3,5,3000,10>>,SmoothStep<IntArg<MELT_SIZE_ARG,26000>,Int<6000>>>,TrConcat<TrWipeIn<100>,AlphaL<Red,SmoothStep<Int<29000>,Int<8000>>>,TrExtend<2000,TrFade<300>>,AlphaL<Mix<TwistAngle<>,Red,Orange>,SmoothStep<Int<29000>,Int<8000>>>,TrFade<3000>>,TrFade<250>,SaberBase::LOCKUP_MELT>,
  
  //Fett263 Power Save, if using his prop file hold Aux and click PWR while ON (pointing up) to dim blade in 25% increments.
  EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,

  //Fett263 Spark Tip Ignition and Retraction
  InOutTrL<TrJoin<TrWipeX<Percentage<WavLen<EFFECT_IGNITION>,4>>,TrSparkX<White,Int<400>,Percentage<WavLen<EFFECT_IGNITION>,4>,Int<0>>>,TrJoin<TrWipeInX<WavLen<EFFECT_RETRACTION>>,TrSparkX<White,Int<400>,WavLen<EFFECT_RETRACTION>,Int<32768>>>>,
  
  //Fett263 optional/alternate Passive Battery Monitor: on boot (1st line) or font change (2nd line) you will get a visual indicator at the emitter of your current battery level. This also works without a blade if you have a lit emitter or blade plug. Green is Full, Red is Low (the color will blend from Green to Red as the battery is depleted), the indicator will fade out after 3000 ms and not display again until powered down and back up or fonts change.
  //TransitionEffectL<TrConcat<TrDelay<1500>,Black,TrFade<1000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_BOOT>,
  //TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_NEWFONT>,
  
  //Fett263 On-Demand Battery Level: if using Fett263's prop file Hold AUX and click PWR while OFF, the battery level is represented by the location on the blade; tip = full, hilt = low and color; green = full, yellow = half, red = low
  TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrDelay<2000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<1000>>,EFFECT_BATTERY_LEVEL>,
  
  //False start preon effect
  TransitionEffectL<TrConcat<TrWipeX<Percentage<WavLen<EFFECT_PREON>,26>>,StaticFire<RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>,Mix<Int<10280>,Black,RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>>,0,1,0,2000,2>,TrFadeX<Percentage<WavLen<EFFECT_PREON>,40>>,StaticFire<RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>,Mix<Int<10280>,Black,RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>>,0,1,0,2000,2>,TrFadeX<Percentage<WavLen<EFFECT_PREON>,13>>,AlphaL<HumpFlicker<RotateColorsX<Variation,Rgb16<24155,12712,65535>>,RotateColorsX<Variation,Rgb16<8024,1818,23182>>,50>,SmoothStep<Scale<NoisySoundLevel,Int<-2500>,Int<9500>>,Int<-11500>>>,TrDelayX<Percentage<WavLen<EFFECT_PREON>,50>>>,EFFECT_PREON>,
  
EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
TransitionEffectL<TrConcat<
  TrJoin<TrDelay<2000>, TrInstant>,
  AlphaL<Mix<BatteryLevel, Red, Green>, Bump<BatteryLevel, Int<10000>>>,
  TrFade<300>>, EFFECT_BATTERY_LEVEL>,
TransitionEffectL<TrConcat<
  TrExtend<2000, TrWipe<100>>,
  AlphaL<Rgb16<8357,8357,20393>, SmoothStep<VolumeLevel, Int<-1>>>,
  TrFade<300>>, EFFECT_VOLUME_LEVEL>>; 
/*
Add to preset as StylePtr<GreyscaleFontsNull>()
--------------------------------------------------------------------------*/

/*--------------------------------- GreyscaleFontsEndure -------------------------*/ 
using GreyscaleFontsEndure = Layers<
  Mix<Scale<BladeAngle<19000>,Int<32768>,Int<0>>,Blinking<HumpFlicker<RotateColorsX<Variation,Red>,AudioFlicker<RotateColorsX<Variation,Rgb<128,0,0>>,RotateColorsX<Variation,Rgb16<11585,0,0>>>,35>,RotateColorsX<Variation,Red>,918,900>,HumpFlicker<RotateColorsX<Variation,Red>,AudioFlicker<RotateColorsX<Variation,Rgb<128,0,0>>,RotateColorsX<Variation,Rgb16<11585,0,0>>>,35>>,
  //Heart beat humpflicker - point the blade up to blend in a subtle heart beat - NOTE: Due to the way Proffie works, this isn't always "lined up" and might be slightly ahead or slightly behind the heart beat. Personally, I don't mind this, as it seems like it's just part of the beat. But if you want to fix this you can either change to another preset then change back or turn the saber off and back on until it's lined up.
  //HumpFlicker<RotateColorsX<Variation,Red>,AudioFlicker<RotateColorsX<Variation,Rgb<128,0,0>>,Rgb16<11585,0,0>>,35>,
  //Alternate humpflicker, no heart beat
  TransitionEffectL<TrConcat<TrDelay<1200>,HumpFlicker<RotateColorsX<Variation,Red>,AudioFlicker<RotateColorsX<Variation,Rgb<128,0,0>>,RotateColorsX<Variation,Rgb16<11585,0,0>>>,35>,TrFade<450>,RotateColorsX<Variation,Rgb16<26858,591,0>>,TrFade<300>,RotateColorsX<Variation,Rgb16<65535,11439,0>>,TrFade<50>>,EFFECT_FORCE>,
  //Charge up Force effect. I recommend commenting this out if you'll be using the included Quotes instead of Force sounds (Or wait for Proffie OS6!)
  AlphaL<AudioFlickerL<Stripes<1000,-2000,RandomPerLEDFlicker<RotateColorsX<Variation,Red>,Black>,Black,RotateColorsX<Variation,Red>,Black>>,SwingSpeed<265>>,
  //Audio responsive unstable/stripey swing effect
  AlphaL<BrownNoiseFlicker<RotateColorsX<Variation,Red>,Black,300>,SwingSpeed<350>>,
  //Unstable swing effect
  AlphaL<AlphaL<Stripes<2000,-3750,RotateColorsX<Variation,Rgb16<65535,11439,0>>,RotateColorsX<Variation,Rgb<60,0,0>>,Pulsing<RotateColorsX<Variation,Rgb<30,0,0>>,Black,800>>,Scale<IsLessThan<SwingSpeed<850>,Int<13600>>,Scale<SwingSpeed<850>,Int<-19300>,Int<32768>>,Int<0>>>,SmoothStep<Int<14500>,Int<16000>>>,
  //Bright ripple hard swing effect - swing hard enough to trigger an accent swing and blood orange ripples up the blade
LockupTrL<Layers<
  AlphaL<AudioFlickerL<Rgb<255,150,0>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Int<4000>,Int<26000>>,Int<6000>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,
  AlphaL<Moccasin,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Int<4000>,Int<26000>>,Int<6000>>,Int<10000>>>>,TrConcat<TrInstant,White,TrFade<400>>,TrConcat<TrInstant,White,TrFade<650>,BrownNoiseFlicker<RotateColorsX<Variation,Rgb16<65535,11439,0>>,Black,300>,TrFade<1000>,AudioFlickerL<BrownNoiseFlicker<RotateColorsX<Variation,Red>,Black,300>>,TrFade<2675>>,SaberBase::LOCKUP_NORMAL>,
  //Responsive lockup effect with growly audio responsive heart beat endlock
//LockupTrL<Layers<
  //AlphaL<AudioFlickerL<White>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Int<4000>,Int<26000>>,Int<6000>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,
  //AlphaL<White,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Int<4000>,Int<26000>>,Int<6000>>,Int<10000>>>>,TrConcat<TrInstant,White,TrFade<400>>,TrConcat<TrInstant,White,TrFade<4000>>,SaberBase::LOCKUP_NORMAL>,
  //Alternate standard lockup
  ResponsiveLightningBlockL<Strobe<White,AudioFlicker<White,Blue>,50,1>,TrConcat<TrInstant,AlphaL<White,Bump<Int<12000>,Int<18000>>>,TrFade<200>>,TrConcat<TrInstant,HumpFlickerL<AlphaL<White,Int<16000>>,30>,TrSmoothFade<600>>>,
  //Responsive lightning block
  AlphaL<Mix<Scale<BladeAngle<19000>,Int<32768>,Int<0>>,StyleFire<Gradient<RotateColorsX<Variation,Rgb16<65535,11439,0>>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>>,RotateColorsX<Variation,Rgb<60,0,0>>,0,2,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>>,StyleFire<Gradient<RotateColorsX<Variation,Rgb16<65535,11439,0>>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>>,RotateColorsX<Variation,Rgb<60,0,0>>,0,1,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>>>,SmoothStep<Scale<SlowNoise<Int<3000>>,Int<1750>,Int<4125>>,Int<-4000>>>,
  //Responsive flame emitter effect, point the blade up to speed up the flame
  //AlphaL<StyleFire<Gradient<RotateColorsX<Variation,Rgb16<65535,11439,0>>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>>,RotateColorsX<Variation,Rgb<60,0,0>>,0,1,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>>,SmoothStep<Scale<SlowNoise<Int<3000>>,Int<2000>,Int<4000>>,Int<-4000>>>,
  //Alternate non-responsive flame emitter effect
  ResponsiveStabL<Orange>,
  //Responsive stab
  EffectSequence<EFFECT_BLAST,ResponsiveBlastL<White,Int<400>,Scale<SwingSpeed<200>,Int<100>,Int<400>>,Int<400>>,LocalizedClashL<White,80,30,EFFECT_BLAST>,ResponsiveBlastWaveL<White,Scale<SwingSpeed<400>,Int<500>,Int<200>>,Scale<SwingSpeed<400>,Int<100>,Int<400>>>,BlastL<White,200,200>,ResponsiveBlastFadeL<White,Scale<SwingSpeed<400>,Int<6000>,Int<12000>>,Scale<SwingSpeed<400>,Int<400>,Int<100>>>,ResponsiveBlastL<White,Scale<SwingSpeed<400>,Int<400>,Int<100>>,Scale<SwingSpeed<400>,Int<200>,Int<100>>,Scale<SwingSpeed<400>,Int<400>,Int<200>>>>,
  //Multi-blast, blaster reflect cycles through different responsive effects
  //ResponsiveBlastL<White,Int<400>,Scale<SwingSpeed<200>,Int<100>,Int<400>>>,
  //Alternate responsive blast
  ResponsiveClashL<TransitionEffect<Rgb<255,150,0>,Moccasin,TrInstant,TrFade<100>,EFFECT_CLASH>,TrInstant,TrFade<400>,Scale<BladeAngle<0,16000>,Int<4000>,Int<26000>>,Int<6000>,Int<20000>>,
  //Responsive Clash
  //ResponsiveClashL<White,TrInstant,TrFade<400>,Scale<BladeAngle<0,16000>,Int<4000>,Int<26000>>,Int<6000>,Int<20000>>,
  //Alternate white clash
  TransitionEffectL<TrConcat<TrInstant,Stripes<1900,-2350,RotateColorsX<Variation,Rgb16<65535,5115,0>>,RandomPerLEDFlicker<RotateColorsX<Variation,Red>,Black>,BrownNoiseFlicker<RotateColorsX<Variation,Rgb16<65535,8357,0>>,RotateColorsX<Variation,Orange>,200>,RandomPerLEDFlicker<RotateColorsX<Variation,Red>,RotateColorsX<Variation,Rgb<75,0,0>>>>,TrFade<2350>>,EFFECT_IGNITION>,
  //Unstable ripple ignition effect
  TransitionEffectL<TrConcat<TrInstant,HumpFlickerL<RotateColorsX<Variation,Rgb16<65535,1899,0>>,40>,TrFade<1750>,BrownNoiseFlicker<RotateColorsX<Variation,Rgb16<65535,1899,0>>,Black,300>,TrInstant>,EFFECT_RETRACTION>,
  //Retraction effect, bright humpflicker fades to unstable
  LockupTrL<AlphaL<BrownNoiseFlickerL<White,Int<300>>,SmoothStep<Int<30000>,Int<5000>>>,TrWipeIn<400>,TrFade<300>,SaberBase::LOCKUP_DRAG>,
  //Drag
  LockupTrL<AlphaL<Mix<TwistAngle<>,Rgb<255,200,0>,DarkOrange>,SmoothStep<Int<28000>,Int<5000>>>,TrWipeIn<600>,TrFade<300>,SaberBase::LOCKUP_MELT>,
  //Responsive melt
  EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
  //Power save, if using fett263's prop file hold Aux and click PWR while ON (pointing up) to dim blade in 25% increments.
  InOutTrL<TrJoin<TrWipe<2000>,TrWaveX<White,Int<2150>,Int<400>,Int<2000>,Int<0>>>,TrJoin<TrWipeIn<1750>,TrWaveX<White,Int<1750>,Int<400>,Int<1750>,Int<32768>>>>,
  //Spark tip ignition/retraction
  //InOutTrL<TrWipe<2000>,TrWipeIn<1750>>,
  //Alternate standard ignition/retraction
  TransitionEffectL<TrConcat<TrDelay<1750>,AlphaL<Mix<Trigger<EFFECT_RETRACTION,Int<4250>,Int<6000>,Int<2500>>,BrownNoiseFlicker<Black,RotateColorsX<Variation,Red>,100>,RandomPerLEDFlicker<RotateColorsX<Variation,Red>,RotateColorsX<Variation,Rgb16<14386,0,0>>>,StyleFire<Gradient<RotateColorsX<Variation,Rgb16<65535,11439,0>>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>>,RotateColorsX<Variation,Rgb<60,0,0>>,0,1,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>>>,SmoothStep<Scale<NoisySoundLevel,Int<-1125>,Int<20000>>,Int<-4000>>>,TrDelay<5000>>,EFFECT_RETRACTION>,
  //Audio responsive cooldown retraction effect
  //TransitionEffectL<TrConcat<TrDelay<1500>,Black,TrFade<1000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_BOOT>,
  //TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<Int<0>,Int<6000>>>,TrFade<3000>>,EFFECT_NEWFONT>,
  //Optional/alternate passive battery monitor, on boot (1st line) or font change (2nd line) you will get a visual indicator at the emitter of your current battery level. This also works without a blade if you have a lit emitter or blade plug. Green is Full, Red is Low (the color will blend from Green to Red as the battery is depleted), the indicator will fade out after 3000 ms and not display again until powered down and back up or fonts change.
  TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrDelay<2000>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<1000>>,EFFECT_BATTERY_LEVEL>,
  //On demand battery level, if using fett263's prop file Hold AUX and click PWR while OFF, the battery level is represented by the location on the blade; tip = full, hilt = low and color; green = full, yellow = half, red = low
  TransitionEffectL<TrConcat<TrInstant,AlphaL<Mix<Trigger<EFFECT_PREON,Int<1750>,Int<250>,Int<3000>>,StyleFire<Gradient<RotateColorsX<Variation,Rgb16<65535,11439,0>>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>,RotateColorsX<Variation,Red>>,RotateColorsX<Variation,Rgb<60,0,0>>,0,1,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>,FireConfig<0,2000,5>>,RandomPerLEDFlicker<RotateColorsX<Variation,Red>,RotateColorsX<Variation,Rgb16<14386,0,0>>>,BrownNoiseFlicker<Black,RotateColorsX<Variation,Red>,100>>,SmoothStep<Scale<NoisySoundLevel,Int<-1000>,Int<25000>>,Int<-4000>>>,TrDelay<2000>>,EFFECT_PREON>,
  //Audio responsive charge-up preon effect
  TransitionEffectL<TrConcat<TrDelay<1150>,TransitionLoopL<TrWaveX<RotateColorsX<Variation,Red>,Int<125>,Int<350>,Int<315>,Int<0>>>,TrDelay<850>>,EFFECT_PREON>,
  
EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
TransitionEffectL<TrConcat<
  TrJoin<TrDelay<2000>, TrInstant>,
  AlphaL<Mix<BatteryLevel, Red, Green>, Bump<BatteryLevel, Int<10000>>>,
  TrFade<300>>, EFFECT_BATTERY_LEVEL>,
TransitionEffectL<TrConcat<
  TrExtend<2000, TrWipe<100>>,
  AlphaL<Rgb16<65535,7816,0>, SmoothStep<VolumeLevel, Int<-1>>>,
  TrFade<300>>, EFFECT_VOLUME_LEVEL>>; 
/*
Add to preset as StylePtr<GreyscaleFontsEndure>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainPinkToBlueSparkle -------------------------*/ 
using MainPinkToBlueSparkle = Layers<
Black,
ColorChange<TrSelect<Ifon<Int<1>,Int<0>>,TrInstant,TrFadeX<Int<1000>>>,
Sparkle<Mix<HoldPeakF<SwingSpeed<200>,Int<300>,Scale<SwingSpeed<200>,Int<8000>,Int<24000>>>,Gradient<Red, Blue>,RandomFlicker<Gradient<Red, Blue>,StripesX<Int<16000>,Scale<HoldPeakF<SwingSpeed<200>,Scale<SwingSpeed<200>,Int<1000>,Int<4000>>,Scale<SwingSpeed<200>,Int<4000>,Int<8000>>>,Int<-100>,Int<-3000>>,Mix<Int<24576>,Black,Gradient<Red, Blue>>,Gradient<Red, Blue>,Mix<Int<8192>,Black,Gradient<Red, Blue>>>>>,White,500,100>,
Stripes<3000,-3500,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>,RandomPerLEDFlicker<Mix<Int<7710>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Black>,BrownNoiseFlicker<RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<3855>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,200>,RandomPerLEDFlicker<Mix<Int<10280>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Mix<Int<3855>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>>>,
TransitionEffectL<TrConcat<TrJoin<TrDelayX<RetractionTime<0>>,TrInstant>,Stripes<3000,3500,Gradient<Red, Blue>,RandomPerLEDFlicker<Mix<Int<7710>,Black,Gradient<Red, Blue>>,Black>,BrownNoiseFlicker<Gradient<Red, Blue>,Mix<Int<3855>,Black,Gradient<Red, Blue>>,200>,RandomPerLEDFlicker<Mix<Int<3137>,Black,Gradient<Red, Blue>>,Mix<Int<3855>,Black,Gradient<Red, Blue>>>>,TrFade<800>>,EFFECT_RETRACTION>,
TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,
Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,
LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,
ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,
LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,
LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,
InOutTrL<TrWipeSparkTipX<Gradient<Cyan, Yellow>,BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,
TransitionEffectL<TrConcat<TrExtendX<WavLen<EFFECT_PREON>,TrFade<100>>,AlphaL<HumpFlickerL<Mix<Trigger<EFFECT_PREON,Mult<WavLen<EFFECT_PREON>,Int<24000>>,WavLen<EFFECT_PREON>,Int<500>>,RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,White>,20>,SmoothStep<IntArg<PREON_SIZE_ARG,1084>,Int<-3000>>>,TrFade<200>>,EFFECT_PREON>,
TransitionEffectL<TrConcat<TrInstant,AlphaL<White,SmoothStep<IntArg<EMITTER_SIZE_ARG,2000>,Int<-4000>>>,TrFadeX<Mult<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>,Int<10923>>>,AlphaL<Orange,SmoothStep<IntArg<EMITTER_SIZE_ARG,2000>,Int<-4000>>>,TrFadeX<Mult<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>,Int<10923>>>,AlphaL<Red,SmoothStep<IntArg<EMITTER_SIZE_ARG,2000>,Int<-2000>>>,TrFadeX<Mult<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>,Int<10923>>>>,EFFECT_POSTOFF>,

EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,
TransitionEffectL<TrConcat<
  TrJoin<TrDelay<2000>, TrInstant>,
  AlphaL<Mix<BatteryLevel, Red, Green>, Bump<BatteryLevel, Int<10000>>>,
  TrFade<300>>, EFFECT_BATTERY_LEVEL>,
TransitionEffectL<TrConcat<
  TrExtend<2000, TrWipe<100>>,
  AlphaL<Rgb16<12029,0,35913>, SmoothStep<VolumeLevel, Int<-1>>>,
  TrFade<300>>, EFFECT_VOLUME_LEVEL>>;
  /*
Add to preset as StylePtr<MainPinkToBlueSparkle>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainCalKestisSurvivorBlueBaseColor -------------------------
copyright Fett263 JediSurvivor (Primary Blade) OS7 Style
https://fett263library.com/early-access/#JediSurvivor
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Swing Effect: Unstable Swing (Scaled Responsive Edge) [Color: BaseColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainCalKestisSurvivorBlueBaseColor = Layers<StripesX<Scale<HoldPeakF<Sum<EffectPulseF<EFFECT_IGNITION>,EffectPulseF<EFFECT_ALT_SOUND>>,Int<3000>,Int<3000>>,Int<8000>,Int<3000>>,Scale<HoldPeakF<Sum<EffectPulseF<EFFECT_IGNITION>,EffectPulseF<EFFECT_ALT_SOUND>>,Int<3000>,Int<3000>>,Int<-2600>,Int<-3600>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<12000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,Pulsing<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<8000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,1400>>,AlphaL<AlphaL<Stripes<2000,-3000,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RandomPerLEDFlicker<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<8192>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>>,RandomPerLEDFlicker<Mix<Int<3932>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>>,Scale<IsLessThan<SwingSpeed<600>,Int<13600>>,Scale<SwingSpeed<600>,Int<-19300>,Int<32768>>,Int<0>>>,SmoothStep<Scale<Scale<IsLessThan<SwingSpeed<600>,Int<13600>>,Scale<SwingSpeed<600>,Int<-19300>,Int<32768>>,Int<0>>,Int<28000>,Int<14000>>,Int<16000>>>,TransitionEffectL<TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainCalKestisSurvivorBlueBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainKyloRenUnstableFilmBasedBaseColor -------------------------
copyright Fett263 KyloRen (Primary Blade) OS7 Style
https://fett263library.com/early-access/#KyloRen
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Preon Effect: Overload [Color: BaseColorArg]
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
PostOff Effect: Emitter Glow (Preon Size) [Color: BaseColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Fire Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect (Randomly Selected): Responsive Blast Wave (Random), Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainKyloRenUnstableFilmBasedBaseColor = Layers<StaticFire<BrownNoiseFlicker<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,RandomPerLEDFlicker<Mix<Int<3213>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>>,300>,Mix<Int<10280>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,0,6,10,1000,2>,TransitionEffectL<TrRandom<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<BladeAngle<>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<Stripes<2000,4000,RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Mix<Sin<Int<50>>,Black,RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,Mix<Int<4096>,Black,RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>>,Stripes<2000,3000,RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Mix<Sin<Int<30>>,Black,RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,Mix<Int<8192>,Black,RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<Mix<Int<4096>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,10>,SmoothStep<IntArg<PREON_SIZE_ARG,-1306>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<Mix<Int<4096>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,15>,SmoothStep<Sum<Int<2000>,IntArg<PREON_SIZE_ARG,-1306>>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<Mix<Int<4096>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,20>,SmoothStep<Sum<Int<4000>,IntArg<PREON_SIZE_ARG,-1306>>,Int<-4000>>>,TrBoingX<Mult<Int<8192>,WavLen<EFFECT_PREON>>,3>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrInstant,AlphaL<White,Int<0>>,TrJoin<TrDelay<1000>,TrInstant>,AlphaL<Mix<Int<4096>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,SmoothStep<IntArg<PREON_SIZE_ARG,2000>,Int<-2000>>>,TrSmoothFadeX<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>>>,EFFECT_POSTOFF>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainKyloRenUnstableFilmBasedBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainKyloRenUnstableSupremeLeaderBaseColor -------------------------
copyright Fett263 KyloRen (Primary Blade) OS7 Style
https://www.fett263.com/fett263-proffieOS7-style-library.html#KyloRen
OS7.14 v3.01p
Single Style
Style Option

--Effects Included--
Preon Effect: Overload [Color: PreonColorArg]
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
PostOff Effect: Emitter Glow (Preon Size) [Color: PostOffColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Stab Effect: Normal Stab [Color: StabColorArg]
Blast Effect (Randomly Selected): Blast Wave (Random), Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Responsive Clash [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainKyloRenUnstableSupremeLeaderBaseColor = Layers<StripesX<Int<1500>,Scale<SlowNoise<Int<2500>>,Int<-3000>,Int<-5000>>,RgbArg<BASE_COLOR_ARG,Rgb<150,0,0>>,Mix<Int<10280>,Black,RgbArg<BASE_COLOR_ARG,Rgb<150,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<150,0,0>>,Mix<Int<2570>,Black,RgbArg<BASE_COLOR_ARG,Rgb<150,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<150,0,0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrRandom<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,10>,SmoothStep<IntArg<PREON_SIZE_ARG,2000>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,15>,SmoothStep<Sum<Int<2000>,IntArg<PREON_SIZE_ARG,2000>>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,20>,SmoothStep<Sum<Int<4000>,IntArg<PREON_SIZE_ARG,2000>>,Int<-4000>>>,TrBoingX<Mult<Int<8192>,WavLen<EFFECT_PREON>>,3>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrInstant,AlphaL<White,Int<0>>,TrJoin<TrDelay<1000>,TrInstant>,AlphaL<RgbArg<POSTOFF_COLOR_ARG,Rgb<255,255,255>>,SmoothStep<IntArg<PREON_SIZE_ARG,2000>,Int<-2000>>>,TrSmoothFadeX<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>>>,EFFECT_POSTOFF>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<150,0,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainKyloRenUnstableSupremeLeaderBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainLiveActionDarksaberHyperResponsiveBaseColor -------------------------
copyright Fett263 DarkSaber (Primary Blade) OS7 Style
https://fett263library.com/early-access/#DarkSaber
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainLiveActionDarksaberHyperResponsiveBaseColor = Layers<Mix<HoldPeakF<SwingSpeed<400>,Scale<SwingAcceleration<>,Int<2000>,Int<4000>>,Int<8000>>,HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,Stripes<35000,-200,Mix<Int<14000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,Mix<Int<24000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,Mix<Int<28000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>>,100>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainLiveActionDarksaberHyperResponsiveBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- ControlMainSabineWrenBaseColor -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using ControlMainSabineWrenBaseColor = Layers<AudioFlicker<Stripes<23000,-1300,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<11565>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<16448>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainSabineWrenBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- ControlMainShinHatiBaseColor -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using ControlMainShinHatiBaseColor = Layers<AudioFlicker<Stripes<25000,-1400,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,Mix<Int<12600>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,Mix<Int<18600>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainShinHatiBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- ControlMainEzraBridgerBaseColor -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using ControlMainEzraBridgerBaseColor = Layers<AudioFlicker<Stripes<23000,-1300,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<11284>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<16384>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainEzraBridgerBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- ControlMainEzraBridgerKyberSelectColorChange -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Base Style: Ezra Bridger
Kyber Select Interactive Control: While Blade is On, use Color Change.

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Emitter Off Effect: Base Color Glow (One-Time Preset Indicator) [Color: Kyber Select (Color Change)]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 10% Increment
*/
using ControlMainEzraBridgerKyberSelectColorChange = Layers<Black,AudioFlicker<Stripes<23000,-1300,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Mix<Int<11284>,Black,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Mix<Int<16384>,Black,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>>,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>,TransitionEffectL<TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,ColorSelect<IncrementWithReset<EffectPulseF<EFFECT_IGNITION>,EffectPulseF<EFFECT_NEWFONT>,Int<1>>,TrInstant,Mix<SmoothStep<IntArg<EMITTER_SIZE_ARG,2000>,Int<-1000>>,Black,RotateColorsX<Int<4096>,ColorChange<TrInstant,RgbArg<EMITTER_COLOR_ARG,Rgb<255,255,255>>,RgbArg<EMITTER_COLOR_ARG,Rgb<255,255,255>>>>>,Black>>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<3277>>,AlphaL<Black,Int<6554>>,AlphaL<Black,Int<9831>>,AlphaL<Black,Int<13108>>,AlphaL<Black,Int<16385>>,AlphaL<Black,Int<19662>>,AlphaL<Black,Int<22939>>,AlphaL<Black,Int<26216>>,AlphaL<Black,Int<29493>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainEzraBridgerKyberSelectColorChange>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainEzraBridgerKyberSelectColorChange -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Base Style: Ezra Bridger
Kyber Select Interactive Control: While Blade is On, use Color Change.

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Emitter Off Effect: Base Color Glow (One-Time Preset Indicator) [Color: Kyber Select (Color Change)]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 10% Increment
*/
using MainEzraBridgerKyberSelectColorChange = Layers<Black,AudioFlicker<Stripes<23000,-1300,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Mix<Int<11284>,Black,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Mix<Int<16384>,Black,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>>,ColorChange<TrInstant,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>,TransitionEffectL<TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,ColorSelect<IncrementWithReset<EffectPulseF<EFFECT_IGNITION>,EffectPulseF<EFFECT_NEWFONT>,Int<1>>,TrInstant,Mix<SmoothStep<IntArg<EMITTER_SIZE_ARG,-678>,Int<-1000>>,Black,RotateColorsX<Int<4096>,ColorChange<TrInstant,RgbArg<EMITTER_COLOR_ARG,Rgb<255,255,255>>,RgbArg<EMITTER_COLOR_ARG,Rgb<255,255,255>>>>>,Black>>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<3277>>,AlphaL<Black,Int<6554>>,AlphaL<Black,Int<9831>>,AlphaL<Black,Int<13108>>,AlphaL<Black,Int<16385>>,AlphaL<Black,Int<19662>>,AlphaL<Black,Int<22939>>,AlphaL<Black,Int<26216>>,AlphaL<Black,Int<29493>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainEzraBridgerKyberSelectColorChange>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainBaylanSkollBaseColor -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Stab Effect: Normal Stab [Color: StabColorArg]
Blast Effect (Randomly Selected): Responsive Blast Wave (Random), Responsive Blast Fade (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainBaylanSkollBaseColor = Layers<AudioFlicker<Stripes<26000,-1400,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,Mix<Int<12600>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,Mix<Int<18600>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrRandom<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<BladeAngle<>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<EffectPosition<EFFECT_BLAST>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,14,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainBaylanSkollBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainAhsokaTanoBaseColor -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainAhsokaTanoBaseColor = Layers<AudioFlicker<Stripes<22000,-1400,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,Mix<Int<10000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,Mix<Int<18000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainAhsokaTanoBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainBladeofTalzinBaseColor -------------------------
copyright Fett263 Ahsoka (Primary Blade) OS7 Style
https://fett263library.com/early-access/#Ahsoka
OS7.14 v4.102
Single Style
Style Option

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Intensity Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Melt - End: Wipe Out
[Color: StabColorArg]
Blast Effect: Blast Wave (Random) [Color: BlastColorArg]
Clash Effect: Real Clash V1 [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainBladeofTalzinBaseColor = Layers<StaticFire<Mix<SmoothStep<Scale<BladeAngle<>,Int<38000>,Int<23000>>,Int<8000>>,Mix<Int<400>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>,Mix<Int<6000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>>,StripesX<Int<14000>,Scale<BladeAngle<>,Int<-5>,Int<-50>>,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,Mix<Scale<HoldPeakF<SwingSpeed<250>,Int<1000>,Int<8000>>,Int<6000>,Int<16000>>,Black,RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>>>,0,2,4,2000,2>,TransitionEffectL<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,EFFECT_BLAST>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,TransitionEffectL<TrWaveX<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Int<100>,Scale<ClashImpactF<>,Int<100>,Int<400>>,Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>>,EFFECT_CLASH>>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Stripes<2000,4000,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,Mix<Sin<Int<50>>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,Mix<Int<4096>,Black,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrConcat<TrExtend<4000,TrWipeIn<200>>,AlphaL<HumpFlicker<Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,RotateColorsX<Int<3000>,Mix<TwistAngle<>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,RotateColorsX<Int<3000>,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>>,100>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrFade<4000>>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,255,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainBladeofTalzinBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- ControlMainFireBladeFastNormalBaseColor -------------------------
copyright Fett263 FireBlade (Primary Blade) OS7 Style
https://www.fett263.com/fett263-proffieOS7-style-library.html#FireBlade
OS7.14 v3.01p
Single Style
Style Option

--Effects Included--
Preon Effect: Overload [Color: PreonColorArg]
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
PostOff Effect: Emitter Glow (Preon Size) [Color: PostOffColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Stab Effect: Normal Stab [Color: StabColorArg]
Blast Effect (Randomly Selected): Blast Wave (Random), Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Responsive Clash [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using ControlMainFireBladeFastNormalBaseColor = Layers<StaticFire<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Mix<Int<10280>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,0,3,0,2000,4>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrRandom<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,10>,SmoothStep<IntArg<PREON_SIZE_ARG,2000>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,15>,SmoothStep<Sum<Int<2000>,IntArg<PREON_SIZE_ARG,2000>>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,20>,SmoothStep<Sum<Int<4000>,IntArg<PREON_SIZE_ARG,2000>>,Int<-4000>>>,TrBoingX<Mult<Int<8192>,WavLen<EFFECT_PREON>>,3>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrInstant,AlphaL<White,Int<0>>,TrJoin<TrDelay<1000>,TrInstant>,AlphaL<RgbArg<POSTOFF_COLOR_ARG,Rgb<255,255,255>>,SmoothStep<IntArg<PREON_SIZE_ARG,2000>,Int<-2000>>>,TrSmoothFadeX<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>>>,EFFECT_POSTOFF>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainFireBladeFastNormalBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- MainHyperResponsiveRotoscopeErraticBaseColor -------------------------
copyright Fett263 Rotoscope (Primary Blade) OS7 Style
https://www.fett263.com/fett263-proffieOS7-style-library.html#Rotoscope
OS7.14 v3.01p
Single Style
Style Option

--Effects Included--
Preon Effect: Overload [Color: PreonColorArg]
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
PostOff Effect: Emitter Glow (Preon Size) [Color: PostOffColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Responsive Impact - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Wipe In - Style: Sparking Drag - End: Wipe Out
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Wipe Out
[Color: StabColorArg]
Stab Effect: Normal Stab [Color: StabColorArg]
Blast Effect (Randomly Selected): Blast Wave (Random), Responsive Blast Fade (Sound Based) [Color: BlastColorArg]
Clash Effect: Responsive Clash [Color: ClashColorArg]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using MainHyperResponsiveRotoscopeErraticBaseColor = Layers<Mix<HoldPeakF<SwingSpeed<250>,Scale<SwingAcceleration<100>,Int<50>,Int<500>>,Scale<SwingAcceleration<>,Int<20000>,Int<10000>>>,Mix<Scale<IsLessThan<SlowNoise<Int<2000>>,Int<18000>>,Int<0>,Int<32768>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Stripes<12000,-800,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Mix<Int<7710>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,Mix<Int<16448>,Black,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>>>,RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<WavLen<>>,TrWipeIn<200>>,AlphaL<RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,SmoothStep<IntArg<MELT_SIZE_ARG,28000>,Int<2000>>>,TrWipe<200>>,EFFECT_STAB>,TransitionEffectL<TrRandom<TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<EffectRandomF<EFFECT_BLAST>,Int<100>,Int<400>>,Int<100>,Scale<EffectPosition<EFFECT_BLAST>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>,TrConcat<TrInstant,AlphaMixL<Bump<Scale<BladeAngle<>,Int<28000>,Int<8000>>,Scale<WavLen<>,Int<9000>,Int<13000>>>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<16384>,Black,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>>>,TrFade<300>>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AlphaL<AlphaMixL<Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,BrownNoiseFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>,300>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<22000>>>>,AlphaL<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<SwingSpeed<100>,Int<14000>,Int<18000>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,ResponsiveLightningBlockL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,AlphaL<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Int<10000>,Int<21000>>,Int<10000>>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,Int<1>>,LockupTrL<AlphaL<BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,SmoothStep<Scale<TwistAngle<>,IntArg<DRAG_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<AlphaL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,SmoothStep<Scale<TwistAngle<>,IntArg<MELT_SIZE_ARG,28000>,Int<30000>>,Int<3000>>>,TrWipeIn<200>,TrWipe<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<300>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrWipeInX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,10>,SmoothStep<IntArg<PREON_SIZE_ARG,2000>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,15>,SmoothStep<Sum<Int<2000>,IntArg<PREON_SIZE_ARG,2000>>,Int<-4000>>>,TrFadeX<Mult<Int<8192>,WavLen<EFFECT_PREON>>>,AlphaL<HumpFlickerL<RgbArg<PREON_COLOR_ARG,Rgb<255,255,255>>,20>,SmoothStep<Sum<Int<4000>,IntArg<PREON_SIZE_ARG,2000>>,Int<-4000>>>,TrBoingX<Mult<Int<8192>,WavLen<EFFECT_PREON>>,3>>,EFFECT_PREON>,TransitionEffectL<TrConcat<TrInstant,AlphaL<White,Int<0>>,TrJoin<TrDelay<1000>,TrInstant>,AlphaL<RgbArg<POSTOFF_COLOR_ARG,Rgb<255,255,255>>,SmoothStep<IntArg<PREON_SIZE_ARG,2000>,Int<-2000>>>,TrSmoothFadeX<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>>>,EFFECT_POSTOFF>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,AlphaL<Mix<BatteryLevel,Red,Green>,Bump<BatteryLevel,Int<10000>>>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<255,0,0>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<MainHyperResponsiveRotoscopeErraticBaseColor>()
--------------------------------------------------------------------------*/

/*-------------------------------------- HexSpiralOffsetStyle --------------------------------------
Custom Dual Blade Spiral Effect for Hexcore Blades - OS7
Designed by JediMaster 2025

This style creates a rotating spiral using alternating stripes and color sequences. 
Intended for zigzag hexcore blades wired as two addressable blades. Offset allows
the two blades to appear as counter-rotating or out-of-phase for dynamic movement.

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
Retraction Effect: Standard Retraction [Color: RetractionColorArg]
Clash Effect: Simple Clash [Color: White]
Blast Effect: Basic White Blast
Lockup Effect: Standard Lockup [Color: White]
Battery Level: Blade Location (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment

Customize with BASE_COLOR_ARG (default: Blue)
Offset is controlled via HexSpiralStyle<0> or HexSpiralStyle<1> to alternate behavior.
---------------------------------------------------------------------------------------------------*/
template<int dir = 0>
using HexSpiralStyle = Layers<
  InOutHelper<
    SimpleClash<
      Lockup<
        Blast<
		  Mix<
			IsGreaterThan<Int<dir>, Int<0>>,
			Stripes<100, 3000, Black, ColorSequence<150, RgbArg<BASE_COLOR_ARG, Blue>, Mix<Int<8000>, Black, RgbArg<BASE_COLOR_ARG, Blue>>>>,
			Stripes<100, 3000, ColorSequence<150, Mix<Int<8000>, Black, RgbArg<BASE_COLOR_ARG, Blue>>, RgbArg<BASE_COLOR_ARG, Blue>>, Black>
		  >,
		  White
		>,
      AudioFlicker<RgbArg<BASE_COLOR_ARG, Blue>, White>>,
    White>,
  300, 800>,

  EffectSequence<EFFECT_POWERSAVE, AlphaL<Black, Int<16384>>, AlphaL<Black, Int<0>>>,
  TransitionEffectL<TrConcat<
    TrJoin<TrDelay<2000>, TrInstant>,
    AlphaL<Mix<BatteryLevel, Red, Green>, Bump<BatteryLevel, Int<10000>>>,
    TrFade<300>
  >, EFFECT_BATTERY_LEVEL>,
  TransitionEffectL<TrConcat<
    TrExtend<2000, TrWipe<100>>,
    AlphaL<RgbArg<BASE_COLOR_ARG, Blue>, SmoothStep<VolumeLevel, Int<-1>>>,
    TrFade<300>
  >, EFFECT_VOLUME_LEVEL>
>;
/*
Add to preset as StylePtr<HexSpiralStyle<0>>() or StylePtr<HexSpiralStyle<1>>()
-------------------------------------------------------------------------------*/

/*--------------------------------- ControlMainCustomBladeMultiPhaseOriginalColorChange -------------------------
copyright Fett263 CustomBlade (Primary Blade) OS7 Style
https://fett263library.com/early-access/#CustomBlade
OS7.15 v4.21
Single Style
Multi Phase (Original - Color Change) Transition: Fade, Time: 1000

Default: OmniColor Swing [BaseColorArg]
1: Unstable Rage [AltColorArg]
Multi Phase Control: use Color Change with COLOR_CHANGE_DIRECT define (to enable click-to-change).

--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
PowerUp Effect: Power Flash [Color: IgnitionColorArg]
Retraction Effect: Fade Out [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Power Burst - Style: Intensity Sparking Drag - End: Absorb
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Absorb
[Color: StabColorArg]
Blast Effect (Randomly Selected): Full Blade Blast Fade, Blast Wave (Sound Based) [Color: BlastColorArg]
Clash Effect: Responsive Clash [Color: ClashColorArg]
Battery Level: Full Blade (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using ControlMainCustomBladeMultiPhaseOriginalColorChange = Layers<Black,ColorChange<TrSelect<Ifon<Int<1>,Int<0>>,TrInstant,TrFadeX<Int<1000>>>,RotateColorsX<IncrementF<SwingSpeed<600>,Int<16384>,Int<32768>,Scale<SwingSpeed<600>,Int<0>,Int<8000>>>,Mix<NoisySoundLevel,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,Mix<Int<4096>,RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,White>>>,Stripes<3000,-3500,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>,RandomPerLEDFlicker<Mix<Int<7710>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Black>,BrownNoiseFlicker<RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>,Mix<Int<3855>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,200>,RandomPerLEDFlicker<Mix<Int<10280>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>,Mix<Int<3855>,Black,RgbArg<ALT_COLOR_ARG,Rgb<0,255,0>>>>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<IgnitionTime<0>>,TrInstant>,RgbArg<IGNITION_COLOR_ARG,Rgb<255,255,255>>,TrFade<1000>>,EFFECT_IGNITION>,TransitionEffectL<TrRandom<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<WavLen<>,Int<100>,Int<400>>,Int<100>,Scale<WavLen<>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,LockupTrL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,TrWaveX<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<200>,Int<100>,Int<200>,Int<32768>>,TrFade<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,TrWipeIn<200>,TrFade<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<0,0,255>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainCustomBladeMultiPhaseOriginalColorChange>()
--------------------------------------------------------------------------*/

/*--------------------------------- ControlMainLiveActionDarksaberHyperResponsiveBaseColor -------------------------
copyright Fett263 DarkSaber (Primary Blade) OS7 Style
https://fett263library.com/early-access/#DarkSaber
OS7.15 v4.21
Single Style
Multi Phase (Original - Color Change) Transition: Fade, Time: 1000

Default: OmniColor Swing [BaseColorArg]
1: Unstable Rage [AltColorArg]


--Effects Included--
Base Overlay Effect: Style Option
0: Unstable Spark[Color: AltColor3Arg, Type: Full Blade, Loop: Timed Loop, Time: 200, Delay: 1000, Mod: 0]
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
PowerUp Effect: Power Flash [Color: IgnitionColorArg]
Retraction Effect: Fade Out [Color: RetractionColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Power Burst - Style: Intensity Sparking Drag - End: Absorb
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Absorb
[Color: StabColorArg]
Blast Effect (Randomly Selected): Full Blade Blast Fade, Blast Wave (Sound Based) [Color: BlastColorArg]
Clash Effect: Responsive Clash [Color: ClashColorArg]
Battery Level: Full Blade (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using ControlMainLiveActionDarksaberHyperResponsiveBaseColor = Layers<Mix<HoldPeakF<SwingSpeed<400>,Scale<SwingAcceleration<>,Int<2000>,Int<4000>>,Int<8000>>,HumpFlicker<RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,Stripes<35000,-200,Mix<Int<14000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,Mix<Int<24000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,Mix<Int<28000>,Black,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>>,100>,RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>>,TransitionLoopL<TrConcat<TrSparkX<RandomPerLEDFlickerL<RgbArg<ALT_COLOR3_ARG,Rgb<180,130,0>>>,Int<300>,Int<200>,Int<0>>,TrDelayX<Int<1000>>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<IgnitionTime<0>>,TrInstant>,RgbArg<IGNITION_COLOR_ARG,Rgb<255,255,255>>,TrFade<1000>>,EFFECT_IGNITION>,TransitionEffectL<TrRandom<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<WavLen<>,Int<100>,Int<400>>,Int<100>,Scale<WavLen<>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,LockupTrL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,TrWaveX<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<200>,Int<100>,Int<200>,Int<32768>>,TrFade<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,TrWipeIn<200>,TrFade<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<0>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<100,100,150>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainLiveActionDarksaberHyperResponsiveBaseColor>()
--------------------------------------------------------------------------*/

/*--------------------------------- ControlMainFallenOrderCalKestisBaseColor -------------------------
copyright Fett263 FallenOrder (Primary Blade) OS7 Style
https://fett263library.com/early-access/#FallenOrder
OS7.15 v4.21
Single Style
Multi Phase (Original - Color Change) Transition: Fade, Time: 1000

Default: OmniColor Swing [BaseColorArg]
1: Unstable Rage [AltColorArg]


--Effects Included--
Ignition Effect: Standard Ignition [Color: IgnitionColorArg]
PowerUp Effect: Power Flash [Color: IgnitionColorArg]
Retraction Effect: Fade Out [Color: RetractionColorArg]
PostOff Effect: Emitter Cool Off (Emitter Size) [Color: PostOffColorArg]
Lockup Effect:
0: mainLockMulti0Shape - Begin: Real Clash - Style: Intensity AudioFlicker - End: Full Blade Absorb
[Color: LockupColorArg]
Lightning Block Effect:
0: mainLBMulti0Shape - Begin: Full Blade Flash - Style: Strobing AudioFlicker - End: Full Blade Absorb
[Color: LBColorArg]
Drag Effect:
0: mainDragMulti0Shape - Begin: Power Burst - Style: Intensity Sparking Drag - End: Absorb
[Color: DragColorArg]
Melt Effect:
0: mainMeltMulti0Shape - Begin: Wipe In - Style: Intensity Fire Melt - End: Absorb
[Color: StabColorArg]
Blast Effect (Randomly Selected): Full Blade Blast Fade, Blast Wave (Sound Based) [Color: BlastColorArg]
Clash Effect: Responsive Clash [Color: ClashColorArg]
Battery Level: Full Blade (Green to Red)
Display Volume: % Blade [Color: BaseColorArg]
Power Save: 25% Increment
*/
using ControlMainFallenOrderCalKestisBaseColor = Layers<Stripes<16000,-1000,RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>,Pulsing<Mix<Int<11565>,Black,RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>>,RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>,800>,RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>>,TransitionEffectL<TrConcat<TrJoin<TrDelayX<IgnitionTime<0>>,TrInstant>,RgbArg<IGNITION_COLOR_ARG,Rgb<255,255,255>>,TrFade<1000>>,EFFECT_IGNITION>,TransitionEffectL<TrRandom<TrConcat<TrJoin<TrDelay<30>,TrInstant>,RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,TrFade<300>>,TrWaveX<RgbArg<BLAST_COLOR_ARG,Rgb<255,255,255>>,Scale<WavLen<>,Int<100>,Int<400>>,Int<100>,Scale<WavLen<>,Int<100>,Int<400>>,Scale<EffectPosition<EFFECT_BLAST>,Int<28000>,Int<8000>>>>,EFFECT_BLAST>,TransitionEffectL<TrConcat<TrInstant,AlphaL<RgbArg<CLASH_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<12000>,Int<60000>>>>,TrFadeX<Scale<ClashImpactF<>,Int<200>,Int<400>>>>,EFFECT_CLASH>,LockupTrL<TransitionEffect<AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<12000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,AudioFlicker<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Mix<Int<20000>,Black,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>>>,TrExtend<5000,TrInstant>,TrFade<5000>,EFFECT_LOCKUP_BEGIN>,TrConcat<TrJoin<TrDelay<50>,TrInstant>,Mix<IsLessThan<ClashImpactF<>,Int<26000>>,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,AlphaL<RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,Bump<Scale<BladeAngle<>,Scale<BladeAngle<0,16000>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-12000>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<10000>>>,Sum<IntArg<LOCKUP_POSITION_ARG,16000>,Int<-10000>>>,Scale<ClashImpactF<>,Int<20000>,Int<60000>>>>>,TrFade<300>>,TrConcat<TrInstant,RgbArg<LOCKUP_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_NORMAL,Int<1>>,LockupTrL<Strobe<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,AudioFlicker<RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,Blue>,50,1>,TrConcat<TrExtend<200,TrInstant>,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<200>>,TrConcat<TrInstant,RgbArg<LB_COLOR_ARG,Rgb<255,255,255>>,TrFade<400>>,SaberBase::LOCKUP_LIGHTNING_BLOCK,Int<1>>,LockupTrL<TransitionEffect<RandomPerLEDFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>>,BrownNoiseFlickerL<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<300>>,TrExtend<4000,TrInstant>,TrFade<4000>,EFFECT_DRAG_BEGIN>,TrWaveX<RgbArg<DRAG_COLOR_ARG,Rgb<255,255,255>>,Int<200>,Int<100>,Int<200>,Int<32768>>,TrFade<200>,SaberBase::LOCKUP_DRAG,Int<1>>,LockupTrL<Layers<Stripes<2000,4000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<50>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<4096>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TransitionPulseL<TrConcat<TrExtend<4000,TrInstant>,Stripes<2000,3000,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>,Mix<Sin<Int<30>>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>,Mix<Int<8192>,Black,RgbArg<STAB_COLOR_ARG,Rgb<255,68,0>>>>,TrFade<4000>>,LockupPulseF<SaberBase::LOCKUP_MELT>>>,TrWipeIn<200>,TrFade<200>,SaberBase::LOCKUP_MELT,Int<1>>,InOutTrL<TrWipeX<BendTimePowInvX<IgnitionTime<0>,Mult<IntArg<IGNITION_OPTION2_ARG,10992>,Int<98304>>>>,TrFadeX<BendTimePowX<RetractionTime<200>,Mult<IntArg<RETRACTION_OPTION2_ARG,10992>,Int<98304>>>>,Black>,TransitionEffectL<TrConcat<TrInstant,AlphaL<White,SmoothStep<IntArg<EMITTER_SIZE_ARG,2000>,Int<-4000>>>,TrFadeX<Mult<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>,Int<10923>>>,AlphaL<Orange,SmoothStep<IntArg<EMITTER_SIZE_ARG,2000>,Int<-4000>>>,TrFadeX<Mult<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>,Int<10923>>>,AlphaL<Red,SmoothStep<IntArg<EMITTER_SIZE_ARG,2000>,Int<-2000>>>,TrFadeX<Mult<Scale<IsLessThan<WavLen<EFFECT_POSTOFF>,Int<200>>,WavLen<EFFECT_POSTOFF>,Int<4000>>,Int<10923>>>>,EFFECT_POSTOFF>,EffectSequence<EFFECT_POWERSAVE,AlphaL<Black,Int<8192>>,AlphaL<Black,Int<16384>>,AlphaL<Black,Int<24576>>,AlphaL<Black,Int<0>>>,TransitionEffectL<TrConcat<TrJoin<TrDelay<2000>,TrInstant>,Mix<BatteryLevel,Red,Green>,TrFade<300>>,EFFECT_BATTERY_LEVEL>,TransitionEffectL<TrConcat<TrExtend<2000,TrWipe<100>>,AlphaL<RgbArg<BASE_COLOR_ARG,Rgb<115,15,240>>,SmoothStep<VolumeLevel,Int<-1>>>,TrFade<300>>,EFFECT_VOLUME_LEVEL>>;
/*
Add to preset as StylePtr<ControlMainFallenOrderCalKestisBaseColor>()
--------------------------------------------------------------------------*/