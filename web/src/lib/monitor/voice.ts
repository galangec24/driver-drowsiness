/**
 * TESTING PHASE: the in-car voice, ported from driver_monitor/ui/voice.py (same sentences and
 * timing rules), spoken with the browser's speech synthesis, plus a beep and a vibration.
 */
import { HIGH, MILD, NONE } from './fuzzy';

export const WAKE_UP = 'Wake up! Open your eyes!';

export function messageFor(level: number, reason: string): string {
  const r = (reason || '').toLowerCase();
  if (level >= HIGH) {
    if (r.includes('eyes closed')) return 'Your eyes have been closing. Please pull over safely and rest.';
    if (r.includes('nod')) return 'You are nodding off. Please pull over safely and take a break.';
    if (r.includes('eyes off the road')) return 'Eyes on the road, please. Look ahead now.';
    return 'You seem very drowsy. Please pull over safely and rest before driving on.';
  }
  if (level === MILD) {
    if (r.includes('eyes off the road')) return 'Please keep your eyes on the road.';
    if (r.includes('restless')) return 'Please settle down and focus on the road.';
    if (r.includes('yawn')) return 'You are yawning a lot. Consider taking a break soon.';
    if (r.includes('blink')) return 'Your eyes look tired. Consider taking a break soon.';
    return 'You are showing signs of fatigue. Consider taking a break soon.';
  }
  return '';
}

export class VoiceGuide {
  repeatS = 30;
  gapS = 8;
  settleS = 60;
  private lastText = new Map<string, number>();
  private lastAny = -1e9;
  private level = NONE;
  private recoveredAt = -1e9;

  constructor(private speak: (text: string, urgent: boolean) => void) {}

  private say(text: string, now: number, urgent = false, repeatOk = false): boolean {
    if (!text) return false;
    if (!urgent && now - this.lastAny < this.gapS) return false;
    if (!repeatOk && now - (this.lastText.get(text) ?? -1e9) < this.repeatS) return false;
    this.lastText.set(text, now);
    this.lastAny = now;
    this.speak(text, urgent);
    return true;
  }

  onAlert(level: number, reason: string, now: number) {
    const previous = this.level;
    this.level = level;
    if (level === NONE) {
      if (previous >= MILD && this.say('Thank you. Stay alert and drive safely.', now, previous >= HIGH)) {
        this.recoveredAt = now;
      }
      return;
    }
    const r = (reason || '').toLowerCase();
    if (level >= HIGH && previous >= HIGH && r.startsWith('eyes closed')) {
      this.say(WAKE_UP, now, true, true);
      return;
    }
    const fatigueOnly = level === MILD && !(r.includes('eyes off the road') || r.includes('restless'));
    if (fatigueOnly && now - this.recoveredAt < this.settleS) return;
    this.say(messageFor(level, reason), now, level > previous, level >= HIGH && level > previous);
  }

  greet(name: string, now: number) {
    this.say(`Hello ${name}. Drive safely, I am watching for signs of fatigue.`, now, true);
  }
}

// ------------------------------------------------------------------ browser sound

let audio: AudioContext | null = null;

/** Must run inside a tap (Start button): browsers only allow sound after the user acts. */
export function unlockSound() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
  } catch {
    // no sound on this browser: the screen still shows the warning
  }
}

export function beep(level: number) {
  if (!audio || level === NONE) return;
  const times = level >= HIGH ? [0, 0.25, 0.5] : [0];
  for (const at of times) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = level >= HIGH ? 880 : 660;
    osc.type = 'square';
    gain.gain.value = 0.25;
    osc.connect(gain).connect(audio.destination);
    osc.start(audio.currentTime + at);
    osc.stop(audio.currentTime + at + 0.18);
  }
  try {
    navigator.vibrate?.(level >= HIGH ? [400, 150, 400, 150, 400] : [250]);
  } catch {
    // no vibration motor
  }
}

export function speak(text: string, urgent: boolean) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (urgent) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.volume = 1;
  synth.speak(u);
}
