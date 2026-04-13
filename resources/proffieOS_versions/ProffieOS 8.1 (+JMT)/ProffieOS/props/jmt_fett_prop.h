#ifndef PROPS_JMT_FETT_PROP_H
#define PROPS_JMT_FETT_PROP_H

// Base Fett263 button prop
#include "saber_fett263_buttons.h"
#include "../common/charge_state.h"

#undef PROP_TYPE
#define PROP_TYPE JMTFettProp

// Compile checks
#if defined(JMT_ROLL_PRESETS) && defined(JMT_FLICK_PRESETS)
#error "Choose only one preset gesture: JMT_ROLL_PRESETS or JMT_FLICK_PRESETS"
#endif

#if defined(JMT_PITCH_OFFSET) && !defined(JMT_FLICK_PRESETS)
#error "JMT_PITCH_OFFSET is only valid when JMT_FLICK_PRESETS is enabled"
#endif

#if defined(JMT_ROLL_OFFSET) && !defined(JMT_FLICK_PRESETS)
#error "JMT_ROLL_OFFSET is only valid when JMT_FLICK_PRESETS is enabled"
#endif

#if (defined(JMT_PITCH_OFFSET) || defined(JMT_ROLL_OFFSET)) && !defined(ORIENTATION_ROTATION)
#error "JMT_PITCH_OFFSET / JMT_ROLL_OFFSET require ORIENTATION_ROTATION to be defined"
#endif

#if defined(BLADE_DETECT_PIN) && defined(JMT_BLADE_DETECT)
  #error "Cannot use both BLADE_DETECT_PIN and JMT_BLADE_DETECT. Choose one blade detect method."
#endif

#if defined(JMT_CHARGE_LOCKOUT) && !defined(CHARGE_DETECT_PIN)
#error "JMT_CHARGE_LOCKOUT requires CHARGE_DETECT_PIN to be defined."
#endif

#if defined(JMT_CHARGE_STYLE_PRESET) && !defined(CHARGE_DETECT_PIN)
#error "JMT_CHARGE_STYLE_PRESET requires CHARGE_DETECT_PIN to be defined."
#endif

#if defined(JMT_CHARGE_COMPLETE_ANNOUNCE) && !defined(CHARGE_DETECT_PIN)
#error "JMT_CHARGE_COMPLETE_ANNOUNCE requires CHARGE_DETECT_PIN to be defined."
#endif

#if defined(JMT_CHARGE_LOCKOUT) && !defined(FETT263_SAVE_GESTURE_OFF)
#warning "JMT_CHARGE_LOCKOUT without FETT263_SAVE_GESTURE_OFF will not preserve full prior gesture state."
#endif

#ifdef JMT_BLADE_DETECT

  #ifndef ENABLE_POWER_FOR_ID
    #error "JMT_BLADE_DETECT requires ENABLE_POWER_FOR_ID to be defined."
  #endif

  #ifndef BLADE_ID_SCAN_MILLIS
    #error "JMT_BLADE_DETECT requires BLADE_ID_SCAN_MILLIS to be defined."
  #endif

  #ifndef BLADE_ID_TIMES
    #error "JMT_BLADE_DETECT requires BLADE_ID_TIMES to be defined."
  #endif

  #if BLADE_ID_SCAN_MILLIS <= 0
    #error "BLADE_ID_SCAN_MILLIS must be greater than 0 for JMT_BLADE_DETECT."
  #endif

  #if BLADE_ID_TIMES <= 0
    #error "BLADE_ID_TIMES must be greater than 0 for JMT_BLADE_DETECT."
  #endif

#endif

// -----------------------------------------------------------------------------
// File-scope configuration and helpers
//
// These are compile-time configuration defaults and small math utilities used
// by the preset flick gesture. They are intentionally defined outside the class:
//
// - Macros must exist before class parsing.
// - Helpers are stateless and not part of object behavior.
// - `static inline` keeps them local to this translation unit.
// -----------------------------------------------------------------------------
bool g_charge_full = false;
bool g_charging = false;

#if NUM_BUTTONS == 1
	#define JMT_DISABLE_FAVORITES
#endif

#ifdef JMT_FLICK_PRESETS
	#ifndef JMT_PITCH_OFFSET
	#define JMT_PITCH_OFFSET 0
	#endif
	#ifndef JMT_ROLL_OFFSET
	#define JMT_ROLL_OFFSET 0
	#endif
	static inline float WrapPi(float x) {
	  while (x >  M_PI) x -= 2.0f * M_PI;
	  while (x < -M_PI) x += 2.0f * M_PI;
	  return x;
	}
#endif

class JMTFettProp : public SaberFett263Buttons {
public:
	JMTFettProp() : SaberFett263Buttons() {}

	const char* name() override { return "MyFettProp"; }

// ---------- Setup -------------------------------------------------
void Setup() override {
    // Run normal Fett setup first
    SaberFett263Buttons::Setup();

	#ifdef CHASSIS_DETECT_PIN

		#ifdef CHASSIS_DETECT_PIN_HIGH
			// Active HIGH chassis detect.
			// Pin is driven HIGH by a valid logic source (<= 3.3V, e.g. board 3.3V
			// or battery via a resistor divider). Pin must be held LOW when the
			// chassis is absent using a pulldown (internal or external).
			pinMode(CHASSIS_DETECT_PIN, INPUT);
			chassis_in_ = (digitalRead(CHASSIS_DETECT_PIN) == HIGH);
		#else
			// Active LOW chassis detect.
			// Pin is normally pulled HIGH internally and is shorted to board GND
			// when the chassis is present.
			pinMode(CHASSIS_DETECT_PIN, INPUT_PULLUP);
			chassis_in_ = (digitalRead(CHASSIS_DETECT_PIN) == LOW);
		#endif

	#endif

	#ifdef CHARGE_DETECT_PIN
		pinMode(CHARGE_DETECT_PIN, INPUT_PULLUP);
		charging_active_ = (digitalRead(CHARGE_DETECT_PIN) == LOW);
		g_charging = charging_active_;
	#endif
}

// ---------- Loop --------------------------------------------------
void Loop() override {
    // Normal Fett behavior
    SaberFett263Buttons::Loop();

	#ifdef CHASSIS_DETECT_PIN
			HandleChassisDetect();
		
		#ifdef JMT_ROLL_PRESETS
			HandleRollPresetGesture();
		#endif
		
		#ifdef JMT_FLICK_PRESETS
			HandlePosePresetFlick();
		#endif
	#endif

	#ifdef CHARGE_DETECT_PIN
		HandleChargeDetect();

		#ifdef JMT_CHARGE_STYLE_PRESET
			int current = current_preset_.preset_num;

			if (!preset_tracker_initialized_) {
				last_seen_preset_ = current;
				preset_tracker_initialized_ = true;
			} else if (current != last_seen_preset_) {
				HandleChargePresetLanding(last_seen_preset_, current);
				last_seen_preset_ = current_preset_.preset_num;
			}
		#endif
	#endif

	#ifdef JMT_BLADE_DETECT
		#ifdef CHARGE_DETECT_PIN
			if (!charging_active_) {
				HandleJmtBladeDetect();
			}
		#else
			HandleJmtBladeDetect();
		#endif
	#endif

	#ifdef JMT_DEBUG_GYRO
		DebugGyro();
	#endif

	#ifdef JMT_DEBUG_GYRO_MAG
		DebugGyroMag();
	#endif

	#ifdef JMT_DEBUG_ANGLES
		DebugAngles();
	#endif

	#ifdef JMT_DEBUG_ANGLES_GYRO_MAG
		DebugAnglesWithGyroMag();
	#endif
}

// ---------- Event2 ------------------------------------------------
bool Event2(enum BUTTON button, EVENT event, uint32_t modifiers) override {

	#ifdef CHASSIS_DETECT_PIN
		// If chassis is OUT, block swing-based ignition while OFF
		if (!chassis_in_) {
			if (EVENTID(button, event, modifiers) ==
				EVENTID(BUTTON_NONE, EVENT_SWING, MODE_OFF)) {
			return true;  // swallow the swing-on event
			}
		}
	#endif

	#ifndef JMT_DISABLE_FAVORITES
		if (favorites_ignore_button_ != BUTTON_NONE) {
			if (button == favorites_ignore_button_) {
				if (event == EVENT_RELEASED || event == EVENT_FIRST_RELEASED) {
					favorites_ignore_button_ = BUTTON_NONE;
				}
				return true;
			}
		}

		if (favorites_reset_pending_) {
			if (button == BUTTON_POWER && event == EVENT_FIRST_PRESSED) {
				favorites_ignore_button_ = BUTTON_POWER;
				ConfirmResetFavorites();
				return true;
			}

			if (button == BUTTON_AUX && event == EVENT_FIRST_PRESSED) {
				favorites_ignore_button_ = BUTTON_AUX;
				CancelResetFavorites();
				return true;
			}

			// While reset is armed, swallow everything else.
			return true;
		}

		switch (EVENTID(button, event, modifiers)) {
			case EVENTID(BUTTON_AUX, EVENT_FIRST_HELD_LONG, MODE_OFF):
				HandleFavoriteActionByAngle();
				return true;
		}
	#endif

	#ifdef JMT_CHARGE_LOCKOUT
		if (ChargeButtonLockoutActive()) {
			static uint32_t last_charge_button_time = 0;
			uint32_t now = millis();

			if (button == BUTTON_POWER) {
				// accept the first power-button event, then ignore repeats briefly
				if (now - last_charge_button_time > 300) {
					last_charge_button_time = now;
					SaberBase::DoEffect(EFFECT_BATTERY_LEVEL, 0);
				}
				return true;
			}

			#ifdef BLADE_DETECT_PIN
				if (button == BUTTON_BLADE_DETECT) return true;
			#endif

			return true;
		}
	#endif
	
	// Let Fett handle everything else normally
	bool ret = SaberFett263Buttons::Event2(button, event, modifiers);

	#ifdef BLADE_DETECT_PIN
		// Silent motion wake on blade insert (no sounds, no ignition)
		switch (EVENTID(button, event, modifiers)) {
			case EVENTID(BUTTON_BLADE_DETECT, EVENT_LATCH_ON, MODE_ANY_BUTTON | MODE_ON):
			case EVENTID(BUTTON_BLADE_DETECT, EVENT_LATCH_ON, MODE_ANY_BUTTON | MODE_OFF):
			case EVENTID(BUTTON_BLADE_DETECT, EVENT_LATCH_OFF, MODE_ANY_BUTTON | MODE_ON):
			case EVENTID(BUTTON_BLADE_DETECT, EVENT_LATCH_OFF, MODE_ANY_BUTTON | MODE_OFF):
		#ifndef JMT_DISABLE_FAVORITES
				AbortPendingFavoriteReset();
		#endif
				if (event == EVENT_LATCH_ON) SaberBase::RequestMotion();
				break;
		}
	#endif

    return ret;
}

protected:

// ---------- Helpers: charge detect -------------------------------
#ifdef CHARGE_DETECT_PIN
	// Charge detect state
	bool charging_active_ = false;

	#ifdef JMT_CHARGE_COMPLETE_ANNOUNCE
		bool charge_complete_announced_ = false;
	#endif

	// Charge full setup
	bool charge_full_ = false;
	uint32_t charge_full_since_ = 0;

	#ifndef CHARGE_FULL_ENTER
		#define CHARGE_FULL_ENTER 32700
	#endif
	#ifndef CHARGE_FULL_EXIT
		#define CHARGE_FULL_EXIT 32000
	#endif
	#ifndef CHARGE_FULL_DWELL_MS
		#define CHARGE_FULL_DWELL_MS 30000
	#endif

	// Charge full related compile checks
	#if CHARGE_FULL_EXIT >= CHARGE_FULL_ENTER
		#error "CHARGE_FULL_EXIT must be less than CHARGE_FULL_ENTER."
	#endif
	#if CHARGE_FULL_DWELL_MS <= 0
		#error "CHARGE_FULL_DWELL_MS must be greater than 0."
	#endif

	void HandleChargeDetect() {
		static bool     charge_initialized = false;
		static bool     charge_last_raw    = false;
		static bool     charge_stable      = false;
		static uint32_t charge_last_change = 0;

		// Active low: LOW = charger present, HIGH = charger absent
		bool charge_raw = (digitalRead(CHARGE_DETECT_PIN) == LOW);
		uint32_t now = millis();

		// Silent first-run sync
		if (!charge_initialized) {
			charge_initialized = true;
			charge_last_raw = charge_raw;
			charge_stable = charge_raw;
			charge_last_change = now;
			charging_active_ = charge_stable;
			g_charging = charging_active_;

			#ifdef JMT_CHARGE_LOCKOUT
				if (charging_active_) {
					ApplyChargeLockout();
				} else {
					ReleaseChargeLockout();
				}
			#endif

			#ifdef JMT_CHARGE_STYLE_PRESET
				if (charging_active_) {
					EnterChargePreset();
				}
			#endif

			return;
		}

		// Track raw changes
		if (charge_raw != charge_last_raw) {
			charge_last_raw = charge_raw;
			charge_last_change = now;
		}

		// Only accept a new state if it stayed the same for DEBOUNCE_MS
		const uint32_t DEBOUNCE_MS = 30;
		if (charge_raw != charge_stable &&
			(now - charge_last_change) > DEBOUNCE_MS) {

			charge_stable = charge_raw;
			charging_active_ = charge_stable;
			g_charging = charging_active_;

			if (charging_active_) {
				sound_library_.Play("chargebegin.wav");
				
				#ifndef JMT_DISABLE_FAVORITES
					AbortPendingFavoriteReset();
				#endif			
			}

			#ifdef JMT_CHARGE_LOCKOUT
				if (charging_active_) {
					ApplyChargeLockout();
				} else {
					ReleaseChargeLockout();
				}
			#endif

			#ifdef JMT_CHARGE_STYLE_PRESET
				if (charging_active_) {
					EnterChargePreset();
					SaberBase::DoEffect(EFFECT_BOOT, 0);
				} else {
					ExitChargeMode();
				}
			#endif
		}
		
		// Keep saber awake while charging
		if (charging_active_) {
			SaberBase::RequestMotion();
		}
		UpdateChargeFull();
	}

	void ExitChargeMode() {
		// Force a full system reboot when exiting charge mode.
		//
		// Charge mode bypasses the normal ProffieOS startup path. Simply restoring
		// the previous preset does not trigger the standard boot lifecycle that
		// occurs after a real power-on. That lifecycle includes:
		//
		//   - font scanning and initialization
		//   - motion engine startup
		//   - amplifier and audio system initialization
		//   - EFFECT_BOOT triggering for blade styles
		//
		// Many styles rely on EFFECT_BOOT for their startup animations. Since that
		// event is not generated when leaving charge mode, we intentionally reset
		// the MCU to simulate a true power cycle so ProffieOS runs its full boot
		// sequence again.
		//
		// This guarantees the saber returns to a clean, fully initialized runtime
		// state identical to powering the board on from cold.
		NVIC_SystemReset();
	}

	#ifdef JMT_CHARGE_LOCKOUT
		bool charge_lockout_applied_ = false;

		bool ChargeButtonLockoutActive() const {
			return charging_active_;
		}

		void ApplyChargeLockout() {
			if (charge_lockout_applied_) return;
			charge_lockout_applied_ = true;
		}

		void ReleaseChargeLockout() {
			if (!charge_lockout_applied_) return;
			charge_lockout_applied_ = false;
		}
	#endif

	#ifdef JMT_CHARGE_STYLE_PRESET
		bool preset_tracker_initialized_ = false;
		int last_seen_preset_ = -1;

		int ChargePresetIndex() {
			return GetNumberOfPresets() - 1;
		}

		bool HasChargePreset() {
			return GetNumberOfPresets() > 0;
		}

		bool IsChargePreset(int preset) {
			return preset == ChargePresetIndex();
		}

		void HandleChargePresetLanding(int previous, int current) {
			int count = GetNumberOfPresets();

			if (count <= 1) return;
			if (charging_active_) return;
			if (!IsChargePreset(current)) return;

			if (previous < 0 || previous >= count) {
				AdvancePresetForward();
				return;
			}

			int forward_dist = current - previous;
			if (forward_dist < 0) forward_dist += count;

			int backward_dist = previous - current;
			if (backward_dist < 0) backward_dist += count;

			if (forward_dist <= backward_dist) {
				AdvancePresetForward();
			} else {
				AdvancePresetBackward();
			}
		}

		void AdvancePresetForward() {
			if (SaberBase::IsOn()) {
				next_preset_fast();
			} else {
				next_preset();
			}
		}

		void AdvancePresetBackward() {
			if (SaberBase::IsOn()) {
				previous_preset_fast();
			} else {
				previous_preset();
			}
		}

		void EnterChargePreset() {
			if (!HasChargePreset()) return;

			int charge_preset = ChargePresetIndex();
			int current = current_preset_.preset_num;

			if (IsChargePreset(current)) return;

			SetPreset(charge_preset, false);
		}
	#endif

	void UpdateChargeFull() {
		if (!charging_active_) {
			charge_full_ = false;
			charge_full_since_ = 0;
			g_charge_full = false;

			#ifdef JMT_CHARGE_COMPLETE_ANNOUNCE
				charge_complete_announced_ = false;
			#endif
			return;
		}

		int level32768 = clampi32(
			battery_monitor.battery_percent() * 32768 / 100,
			0, 32768);

		uint32_t now = millis();

		if (!charge_full_) {
			if (level32768 >= CHARGE_FULL_ENTER) {
				if (!charge_full_since_) {
					charge_full_since_ = now;
				} else if (now - charge_full_since_ > CHARGE_FULL_DWELL_MS) {
					charge_full_ = true;
				}
			} else {
				charge_full_since_ = 0;
			}
		} else {
			if (level32768 <= CHARGE_FULL_EXIT) {
				charge_full_ = false;
				charge_full_since_ = 0;
			}
		}

		g_charge_full = charge_full_;

		#ifdef JMT_CHARGE_COMPLETE_ANNOUNCE
			if (charge_full_ && !charge_complete_announced_) {
				sound_library_.Play("chargecomplete.wav");
				charge_complete_announced_ = true;
			}
		#endif
	}

#endif  // CHARGE_DETECT_PIN

// ---------- Helpers: chassis detect -------------------------------
#ifdef CHASSIS_DETECT_PIN
	// Chassis detect state
	bool chassis_in_ = false;
  
	#ifdef JMT_ROLL_PRESETS
		bool  roll_preset_armed_ = false;
		float roll_preset_start_angle_ = 0.0f;
	#endif

	#ifdef JMT_FLICK_PRESETS
		enum PresetPoseState {
			POSE_IDLE = 0,
			POSE_WAIT_RETURN_NEXT,
			POSE_WAIT_RETURN_PREV,
		};

		PresetPoseState pose_state_ = POSE_IDLE;
		uint32_t pose_t0_ = 0;
		uint32_t arm_eligible_until_ = 0;
	  
		// ---------- Helpers ----------
		static inline bool NearDeg(float deg, float target, float tol) {
			return fabsf(deg - target) <= tol;
		}

		static inline bool NearRollDeg(float deg, float target, float tol) {
			while (deg >  180.0f) deg -= 360.0f;
			while (deg < -180.0f) deg += 360.0f;

			while (target >  180.0f) target -= 360.0f;
			while (target < -180.0f) target += 360.0f;

			float d = deg - target;
			while (d >  180.0f) d -= 360.0f;
			while (d < -180.0f) d += 360.0f;
			return fabsf(d) <= tol;
		}
	#endif
  
	void HandleChassisDetect() {
		// Debounce for chassis detect
		static bool		chassis_last_raw	= false;	// last instantaneous read
		static bool		chassis_stable		= false;	// debounced state
		static uint32_t	chassis_last_change	= 0;		// when raw state last flipped

		// LOW = inserted, HIGH = removed (INPUT_PULLUP) or reversed if CHASSIS_DETECT_PIN_HIGH
		#ifdef CHASSIS_DETECT_PIN_HIGH
			bool chassis_raw = (digitalRead(CHASSIS_DETECT_PIN) == HIGH);
		#else
			bool chassis_raw = (digitalRead(CHASSIS_DETECT_PIN) == LOW);
		#endif

		uint32_t now = millis();

		// Track raw changes
		if (chassis_raw != chassis_last_raw) {
			chassis_last_raw	= chassis_raw;
			chassis_last_change	= now;
		}

		// Only accept a new state if it stayed the same for DEBOUNCE_MS
		const uint32_t DEBOUNCE_MS = 30;
		if (chassis_raw != chassis_stable &&
			(now - chassis_last_change) > DEBOUNCE_MS) {

			chassis_stable = chassis_raw;
			chassis_in_	= chassis_stable;

			sound_library_.Play(chassis_in_ ? "chassisin.wav" : "chassisout.wav");
			
			#ifndef JMT_DISABLE_FAVORITES
				AbortPendingFavoriteReset();
			#endif

			#ifdef JMT_CHASSIS_WAKE
				if (!SaberBase::MotionRequested())
					SaberBase::RequestMotion();
			#endif
		}
	}

	#ifdef JMT_ROLL_PRESETS
		// Roll-to-change-preset, only when blade OFF and chassis OUT
		void HandleRollPresetGesture() {
			if (SaberBase::IsOn() || chassis_in_) {
				roll_preset_armed_ = false;
				return;
			}

			float pitch = fusor.angle1();	// up/down
			float roll	= fusor.angle2();	// roll around blade axis

			const float HORIZ_LIMIT = 7.0f * M_PI / 180.0f;	// ~7 degrees
			if (fabs(pitch) > HORIZ_LIMIT) {
				roll_preset_armed_ = false;
				return;
			}

			// First time in range: capture baseline roll
			if (!roll_preset_armed_) {
				roll_preset_start_angle_ = roll;
				roll_preset_armed_	= true;
				return;
			}

			// delta roll in [-pi, pi]
			float delta = roll - roll_preset_start_angle_;
			if (delta >  M_PI)	delta -= 2.0f * M_PI;
			if (delta < -M_PI)	delta += 2.0f * M_PI;

			const float ROLL_THRESHOLD = 170.0f * M_PI / 180.0f;

			if (delta > ROLL_THRESHOLD) {
				roll_preset_start_angle_ = roll;
				next_preset();
			} else if (delta < -ROLL_THRESHOLD) {
				roll_preset_start_angle_ = roll;
				previous_preset();
			}
		}
	#endif	// JMT_ROLL_PRESETS

	// flick-to-change-preset, only when blade OFF and chassis OUT
	#ifdef JMT_FLICK_PRESETS
		void HandlePosePresetFlick() {
			if (SaberBase::IsOn() || chassis_in_) {
				pose_state_ = POSE_IDLE;
				arm_eligible_until_ = 0;
				return;
			}

			float p = fusor.angle1() * 180.0f / M_PI + (float)JMT_PITCH_OFFSET;
			float r = fusor.angle2() * 180.0f / M_PI + (float)JMT_ROLL_OFFSET;

			// ---- Your measured targets ----
			const float ARM_P  =    0.0f;
			const float ARM_R  = -180.0f;   // same as +180

			const float NEXT_P =   0.0f;
			const float NEXT_R = -90.0f;

			const float PREV_P =   0.0f;
			const float PREV_R =  90.0f;

			// ---- Tunables ----
			const float ARM_PTOL = 18.0f;
			const float ARM_RTOL = 25.0f;

			const float DIR_PTOL = 22.0f;
			const float DIR_RTOL = 22.0f;

			const uint32_t RETURN_DEADLINE_MS = 500;  // tune this first

			auto InArm  = [&]() { return NearDeg(p, ARM_P,  ARM_PTOL) && NearRollDeg(r, ARM_R,  ARM_RTOL); };
			auto InNext = [&]() { return NearDeg(p, NEXT_P, DIR_PTOL) && NearRollDeg(r, NEXT_R, DIR_RTOL); };
			auto InPrev = [&]() { return NearDeg(p, PREV_P, DIR_PTOL) && NearRollDeg(r, PREV_R, DIR_RTOL); };

			uint32_t now = millis();
			const uint32_t ELIGIBLE_MS = 700;  // how long after ARM we allow side entry
			if (InArm()) arm_eligible_until_ = now + ELIGIBLE_MS;

			bool eligible = (int32_t)(arm_eligible_until_ - now) > 0;

			switch (pose_state_) {
				case POSE_IDLE:
					// Eligible if we were in ARM recently, then watch for side entry
					if (eligible) {
						if (InNext()) {
						  pose_state_ = POSE_WAIT_RETURN_NEXT;
						  pose_t0_ = now;
						} else if (InPrev()) {
						  pose_state_ = POSE_WAIT_RETURN_PREV;
						  pose_t0_ = now;
						}
					}
					break;

				case POSE_WAIT_RETURN_NEXT:
					if ((uint32_t)(now - pose_t0_) > RETURN_DEADLINE_MS) {
						pose_state_ = POSE_IDLE;  // too slow, cancel
						break;
					}
					if (InArm()) {
						pose_state_ = POSE_IDLE;
						next_preset();
					}
					break;

				case POSE_WAIT_RETURN_PREV:
					if ((uint32_t)(now - pose_t0_) > RETURN_DEADLINE_MS) {
						pose_state_ = POSE_IDLE;
						break;
					}
					if (InArm()) {
						pose_state_ = POSE_IDLE;
						previous_preset();
					}
					break;
			}
		}
	#endif  // JMT_FLICK_PRESETS
	
#endif	// CHASSIS_DETECT_PIN

// ---------- Helpers: JMT blade detect ---------
#ifdef JMT_BLADE_DETECT
	bool CurrentBladeConfigIsNoBlade() const {
		extern BladeConfig* current_config;
		if (!current_config) return false;
		return current_config->ohm == NO_BLADE;
	}

	void HandleJmtBladeDetect() {
		static bool last_present = false;
		static bool initialized = false;

		bool present = !CurrentBladeConfigIsNoBlade();

		if (!initialized) {
			last_present = present;
			initialized = true;
			return;
		}

		if (present == last_present) return;
		last_present = present;

		#ifndef JMT_DISABLE_FAVORITES
			AbortPendingFavoriteReset();
		#endif

		if (present) {
			#ifdef FETT263_SAVE_GESTURE_OFF
				RestoreGestureState();
			#else
				saved_gesture_control.gestureon = true;
			#endif

			SaberBase::RequestMotion();
		} else {
			#ifdef FETT263_SAVE_GESTURE_OFF
				SaveGestureState();
			#endif
				saved_gesture_control.gestureon = false;
		}
	}
#endif  // JMT_BLADE_DETECT

// ---------- Favorites Helpers --------------------
#ifndef JMT_DISABLE_FAVORITES
	
	#ifdef JMT_MAX_PRESET_FAVORITES
		static const int MAX_FAVORITES = JMT_MAX_PRESET_FAVORITES;
	#else
		static const int MAX_FAVORITES = 10;
	#endif

	int favorites_[MAX_FAVORITES];
	int favorite_count_ = 0;
	bool favorites_loaded_ = false;
	bool favorites_reset_pending_ = false;
	enum BUTTON favorites_ignore_button_ = BUTTON_NONE;
	
	enum FavoriteAddResult {
		
		FAVORITE_ADD_INVALID = 0,
		FAVORITE_ADD_ADDED,
		FAVORITE_ADD_ALREADY_PRESENT,
		FAVORITE_ADD_FULL,
		FAVORITE_ADD_SAVE_FAILED
	};
// ---------- User-facing action entry points ----------
	void HandleToggleFavoriteCurrentPreset() {
		EnsureFavoritesLoaded();

		int preset = current_preset_.preset_num;
		if (!IsValidFavoritePreset(preset)) return;

		if (IsFavoritePreset(preset)) {
			if (RemoveFavoritePreset(preset)) {
				//sound_library_.Play("favoriteremoved.wav");
				Beeps(0.08f, 2000.0f, 2);
			}
			return;
		}

		FavoriteAddResult result = AddFavoritePreset(preset);

		switch (result) {
			case FAVORITE_ADD_ADDED:
				//sound_library_.Play("favoriteadded.wav");
				Beeps(0.08f, 2000.0f);
				break;

			case FAVORITE_ADD_FULL:
				//sound_library_.Play("favoritesfull.wav");
				Beeps(1.00f, 2000.0f);
				break;

			default:
				break;
		}
	}

	void HandleNextFavoritePreset() {
		EnsureFavoritesLoaded();

		if (favorite_count_ == 0) {
			//sound_library_.Play("favoritesempty.wav");
			Beeps(0.03f, 2000.0f, 5);
			return;
		}

		int current = current_preset_.preset_num;
		int next = FindNextFavoritePreset(current);
		if (!IsValidFavoritePreset(next)) return;
		SetPreset(next, true);
	}

	void HandlePreviousFavoritePreset() {
		EnsureFavoritesLoaded();

		if (favorite_count_ == 0) {
			//sound_library_.Play("favoritesempty.wav");
			Beeps(0.03f, 2000.0f, 5);
			return;
		}

		int current = current_preset_.preset_num;
		int prev = FindPreviousFavoritePreset(current);
		if (!IsValidFavoritePreset(prev)) return;
		SetPreset(prev, true);
	}
	
	void HandleFavoriteActionByAngle() {
		const float angle = fusor.angle1();
		const float side_threshold = 5.0 * M_PI / 180.0;

		// Straight down target: -90 degrees
		const float reset_center = -90.0 * M_PI / 180.0;
		const float reset_window = 5.0 * M_PI / 180.0;

		if (fabsf(angle - reset_center) <= reset_window) {
			ArmResetFavorites();
			return;
		}

		if (angle > side_threshold) {
			HandleNextFavoritePreset();
		} else if (angle < -side_threshold) {
			HandlePreviousFavoritePreset();
		} else {
			HandleToggleFavoriteCurrentPreset();
		}
	}

// ---------- Reset / modal helpers ----------
	void ArmResetFavorites() {
		if (favorites_reset_pending_) return;
		EnsureFavoritesLoaded();
		
		if (favorite_count_ == 0) {
			//sound_library_.Play("favoritesempty.wav");
			Beeps(0.03f, 2000.0f, 5);
			return;
		}
				
		favorites_reset_pending_ = true;
		Beeps(0.05f, 2000.0f, 3);
		delay(80);
		sound_library_.Play("mconfirm.wav");
		sound_library_.Play("mdefault.wav");
	}

	void CancelResetFavorites() {
		favorites_reset_pending_ = false;
		sound_library_.Play("mcancel.wav");
	}

	void ConfirmResetFavorites() {
		favorites_reset_pending_ = false;

		if (ResetFavorites()) {
			beeper.Beep(0.08f, 2000.0f);
			delay(80);
			beeper.Beep(0.08f, 2500.0f);
			delay(80);
			sound_library_.Play("mdefault.wav");
		} else {
			sound_library_.Play("mcancel.wav");
		}
	}

	void AbortPendingFavoriteReset() {
		if (!favorites_reset_pending_ && favorites_ignore_button_ == BUTTON_NONE) return;
		favorites_reset_pending_ = false;
		favorites_ignore_button_ = BUTTON_NONE;
		sound_library_.Play("mcancel.wav");
	}

	bool ResetFavorites() {
		// backup current state
		int backup[MAX_FAVORITES];
		int backup_count = favorite_count_;

		for (int i = 0; i < favorite_count_; i++) {
			backup[i] = favorites_[i];
		}

		// clear and attempt save
		ClearFavorites();

		if (SaveFavoritesToFile("favorites.ini")) {
			return true;
		}

		// restore if save failed
		for (int i = 0; i < backup_count; i++) {
			favorites_[i] = backup[i];
		}
		favorite_count_ = backup_count;

		return false;
	}
	
// ---------- Runtime query / validation helpers ----------
	void EnsureFavoritesLoaded() {
		if (!favorites_loaded_) {
			LoadFavoritesFromFile("favorites.ini");
		}
	}

	bool IsFavoritePreset(int preset) {
		for (int i = 0; i < favorite_count_; i++) {
			if (favorites_[i] == preset) return true;
		}
		return false;
	}

	bool IsValidFavoritePreset(int preset) {
		return preset >= 0 && preset < GetNumberOfPresets();
	}

	int FindNextFavoritePreset(int current) {
		if (favorite_count_ == 0) return -1;

		for (int i = 0; i < favorite_count_; i++) {
			if (favorites_[i] > current) {
				return favorites_[i];
			}
		}

		// Wrap to first
		return favorites_[0];
	}

	int FindPreviousFavoritePreset(int current) {
		if (favorite_count_ == 0) return -1;

		for (int i = favorite_count_ - 1; i >= 0; i--) {
			if (favorites_[i] < current) {
				return favorites_[i];
			}
		}

		// Wrap to last
		return favorites_[favorite_count_ - 1];
	}
	
// ---------- Mutation helpers ----------
	FavoriteAddResult AddFavoritePreset(int preset) {
		if (!IsValidFavoritePreset(preset)) {
			return FAVORITE_ADD_INVALID;
		}

		int insert_pos = 0;
		while (insert_pos < favorite_count_ && favorites_[insert_pos] < preset) {
			insert_pos++;
		}

		if (insert_pos < favorite_count_ && favorites_[insert_pos] == preset) {
			return FAVORITE_ADD_ALREADY_PRESENT;
		}

		if (favorite_count_ >= MAX_FAVORITES) {
			return FAVORITE_ADD_FULL;
		}

		for (int i = favorite_count_; i > insert_pos; i--) {
			favorites_[i] = favorites_[i - 1];
		}

		favorites_[insert_pos] = preset;
		favorite_count_++;

		if (!SaveFavoritesToFile("favorites.ini")) {
			for (int i = insert_pos; i < favorite_count_ - 1; i++) {
				favorites_[i] = favorites_[i + 1];
			}
			favorite_count_--;
			return FAVORITE_ADD_SAVE_FAILED;
		}

		return FAVORITE_ADD_ADDED;
	}

	bool RemoveFavoritePreset(int preset) {
		int remove_pos = -1;

		for (int i = 0; i < favorite_count_; i++) {
			if (favorites_[i] == preset) {
				remove_pos = i;
				break;
			}
		}

		if (remove_pos == -1) {
			return true;
		}

		for (int i = remove_pos; i < favorite_count_ - 1; i++) {
			favorites_[i] = favorites_[i + 1];
		}

		favorite_count_--;

		if (!SaveFavoritesToFile("favorites.ini")) {
			for (int i = favorite_count_; i > remove_pos; i--) {
				favorites_[i] = favorites_[i - 1];
			}
			favorites_[remove_pos] = preset;
			favorite_count_++;
			return false;
		}

		return true;
	}

	void ClearFavorites() {
		favorite_count_ = 0;
	}

	bool InsertFavoriteSortedNoSave(int preset) {
		if (!IsValidFavoritePreset(preset)) return false;
		if (favorite_count_ >= MAX_FAVORITES) return false;

		int insert_pos = 0;
		while (insert_pos < favorite_count_ && favorites_[insert_pos] < preset) {
			insert_pos++;
		}

		if (insert_pos < favorite_count_ && favorites_[insert_pos] == preset) {
			return true;
		}

		for (int i = favorite_count_; i > insert_pos; i--) {
			favorites_[i] = favorites_[i - 1];
		}

		favorites_[insert_pos] = preset;
		favorite_count_++;
		return true;
	}
	
// ---------- File parse / persistence helpers ----------
	bool ParseFavoriteLine(const String& line, int& value) {
		if (line.length() == 0) return false;

		for (size_t i = 0; i < line.length(); i++) {
			if (line[i] < '0' || line[i] > '9') return false;
		}

		value = line.toInt();
		return IsValidFavoritePreset(value);
	}

	bool WriteFavoritesFile(const char* filename) {
		LSFS::Remove(filename);

		FileReader out;
		if (!out.Create(filename)) {
			return false;
		}

		for (int i = 0; i < favorite_count_; i++) {
			char line[32];
			snprintf(line, sizeof(line), "%d\n", favorites_[i]);
			out.Write((const uint8_t*)line, strlen(line));
		}

		out.Close();
		return true;
	}

	bool SaveFavoritesToFile(const char* filename) {
		LOCK_SD(true);

		bool ok_primary = WriteFavoritesFile(filename);

		if (ok_primary) {
			WriteFavoritesFile("favorites.bak");  // best-effort backup
		}

		LOCK_SD(false);
		return ok_primary;
	}
	
	bool LoadFavoritesFromOneFile(const char* filename, bool* needs_cleanup = nullptr) {
		ClearFavorites();

		bool local_cleanup = false;

		FileReader f;
		if (!f.Open(filename)) {
			return false;
		}

		String line;

		auto ProcessLine = [&](const String& s) {
			if (!s.length()) return;

			int preset = -1;

			if (ParseFavoriteLine(s, preset)) {
				int old_count = favorite_count_;
				bool inserted = InsertFavoriteSortedNoSave(preset);

				if (!inserted || favorite_count_ == old_count) {
					local_cleanup = true;
				}
			} else {
				local_cleanup = true;
			}
		};

		while (f.Available()) {
			int ch = f.Read();
			if (ch < 0) break;

			char c = (char)ch;

			if (c == '\n' || c == '\r') {
				ProcessLine(line);
				line = "";
			} else {
				line += c;
			}
		}

		ProcessLine(line);
		f.Close();

		if (needs_cleanup) *needs_cleanup = local_cleanup;
		return true;
	}

	bool LoadFavoritesFromFile(const char* filename) {
		LOCK_SD(true);

		bool ok = false;
		bool needs_cleanup = false;
		bool restore_primary = false;

		ok = LoadFavoritesFromOneFile(filename, &needs_cleanup);

		if (!ok) {
			ok = LoadFavoritesFromOneFile("favorites.bak", &needs_cleanup);
			if (ok) restore_primary = true;
		}

		LOCK_SD(false);

		favorites_loaded_ = true;

		if (ok && (needs_cleanup || restore_primary)) {
			SaveFavoritesToFile(filename);
		}

		return ok;
	}

#endif	// !JMT_DISABLE_FAVORITES

// ---------- Helpers: General Functions ---------
	void Beeps(float duration, float freq, int count = 1) {
		for (int i = 0; i < count; i++) {
			beeper.Beep(duration, freq);
			delay((int)(duration * 1000) + 80);
		}
	}
	
// ---------- Helpers: Debug functions ---------
#ifdef JMT_DEBUG_GYRO
	void DebugGyro() {
		static uint32_t last_print = 0;
		if (millis() - last_print < 50) return;  // ~20 Hz
		last_print = millis();

		Vec3 g = fusor.gyro();

		Serial.print("GYRO  X:");
		Serial.print(g.x);
		Serial.print(" Y:");
		Serial.print(g.y);
		Serial.print(" Z:");
		Serial.println(g.z);
	}
#endif

#ifdef JMT_DEBUG_GYRO_MAG
	void DebugGyroMag() {
		static uint32_t last_print = 0;
		if (millis() - last_print < 50) return;
		last_print = millis();

		Vec3 g = fusor.gyro();
		float mag = sqrt(g.x * g.x + g.y * g.y + g.z * g.z);

		Serial.print("GYRO MAG: ");
		Serial.println(mag);
	}
#endif

#ifdef JMT_DEBUG_ANGLES
	void DebugAngles() {
		static uint32_t last_print = 0;
		if (millis() - last_print < 50) return;
		last_print = millis();

		float pitch = fusor.angle1();
		float roll  = fusor.angle2();

		Serial.print("ANG  P:");
		Serial.print(pitch * 180.0f / M_PI);
		Serial.print(" R:");
		Serial.println(roll * 180.0f / M_PI);
	}
#endif

#ifdef JMT_DEBUG_ANGLES_GYRO_MAG
	void DebugAnglesWithGyroMag() {
		static uint32_t last_print = 0;
		if (millis() - last_print < 50) return;
		last_print = millis();

		float pitch = fusor.angle1();
		float roll  = fusor.angle2();

		Vec3 g = fusor.gyro();
		float gmag = sqrtf(g.x*g.x + g.y*g.y + g.z*g.z);

		Serial.print("ANG P:");
		Serial.print(pitch * 180.0f / M_PI);
		Serial.print(" R:");
		Serial.print(roll * 180.0f / M_PI);
		Serial.print("  GMAG:");
		Serial.println(gmag);
	}
#endif

};

#endif  // PROPS_JMT_FETT_PROP_H
