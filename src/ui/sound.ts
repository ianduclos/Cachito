import { useEffect } from "react";

export type SoundName = "clock" | "numDown" | "numUp" | "shake" | "shakeStop" | "turnPass" | "suspense" | "click" | "denomination" | "nextRound" | "tableDice" | "dead" | "rightGuess" | "wrongGuess" | "winner";
export type SoundLevels = { effects: number; music: number };

const SETTINGS_KEY = "cachito-sound-levels";
const clips: Record<SoundName, string> = { clock: "clock_10s.wav", numDown: "num_down.wav", numUp: "num_up.wav", shake: "shake.wav", shakeStop: "shake_stop.wav", turnPass: "turn_pass.wav", suspense: "suspense.wav", click: "click_1.wav", denomination: "click_2.wav", nextRound: "accent_1.wav", tableDice: "accent_2.wav", dead: "dead.wav", rightGuess: "right_guess.wav", wrongGuess: "wrong_guess.wav", winner: "winner.wav" };
const clipVolumes: Partial<Record<SoundName, number>> = { click: 0.42, dead: 0.56, rightGuess: 0.56, wrongGuess: 0.56 };
const boosts: Partial<Record<SoundName, number>> = { shake: 1.65, shakeStop: 1.65, suspense: 2.25 };
const soundNames = Object.keys(clips) as SoundName[];
let levels: SoundLevels = readSoundLevels();
let music: HTMLAudioElement | undefined;
let audioContext: AudioContext | undefined;
let activeEffects = 0;
let musicAnimation = 0;
let soundsPrimed = false;
const effectPools = new Map<SoundName, HTMLAudioElement[]>();
const amplified = new WeakSet<HTMLAudioElement>();

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function readSoundLevels(): SoundLevels {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<SoundLevels> | null;
    return { effects: clamp(saved?.effects ?? 0.85), music: clamp(saved?.music ?? 0.34) };
  } catch { return { effects: 0.85, music: 0.34 }; }
}
export function getSoundLevels() { return { ...levels }; }
export function setSoundLevels(next: SoundLevels) {
  levels = { effects: clamp(next.effects), music: clamp(next.music) };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(levels)); } catch { /* Storage is optional. */ }
  updateMusicVolume();
}
function prepareAudio(source: string) {
  const audio = new Audio(source);
  audio.preload = "auto";
  audio.load();
  return audio;
}
/** Starts fetching and decoding every clip before timing-sensitive game events need it. */
export function preloadSounds() {
  if (soundsPrimed || typeof Audio === "undefined") return;
  soundsPrimed = true;
  music ??= prepareAudio("/sounds/theme.mp3");
  music.loop = true;
  for (const name of soundNames) effectPools.set(name, [prepareAudio(`/sounds/${clips[name]}`), prepareAudio(`/sounds/${clips[name]}`)]);
}
function musicTarget() { return levels.music * (activeEffects ? 0.16 : 1); }
function updateMusicVolume() { if (music) music.volume = musicTarget(); }
function easeOut(value: number) { return 1 - (1 - value) ** 3; }
function easeInOut(value: number) { return value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2; }
function animateMusic(target: number, duration: number, easing: (value: number) => number) {
  if (!music) return;
  cancelAnimationFrame(musicAnimation);
  const start = music.volume;
  const startedAt = performance.now();
  const frame = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    if (music) music.volume = start + (target - start) * easing(progress);
    if (progress < 1) musicAnimation = requestAnimationFrame(frame);
  };
  musicAnimation = requestAnimationFrame(frame);
}
export function startBackgroundMusic() {
  preloadSounds();
  if (!music) { music = prepareAudio("/sounds/theme.mp3"); music.loop = true; }
  updateMusicVolume();
  const playback = music.play();
  void playback?.catch(() => undefined);
}
function duckMusic(effect: HTMLAudioElement) {
  const begin = () => {
    if (!music || music.paused || !Number.isFinite(effect.duration) || effect.duration < 1) return;
    activeEffects += 1;
    animateMusic(musicTarget(), 120, easeOut);
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      activeEffects = Math.max(0, activeEffects - 1);
      animateMusic(musicTarget(), 1_050, easeInOut);
    };
    effect.addEventListener("ended", restore, { once: true });
    window.setTimeout(restore, Math.ceil(effect.duration * 1_000) + 1_000);
  };
  if (Number.isFinite(effect.duration)) begin();
  else effect.addEventListener("loadedmetadata", begin, { once: true });
}
function amplify(audio: HTMLAudioElement, amount: number) {
  if (amount <= 1 || typeof AudioContext === "undefined" || amplified.has(audio)) return;
  try {
    audioContext ??= new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    const gain = audioContext.createGain();
    gain.gain.value = amount;
    source.connect(gain).connect(audioContext.destination);
    amplified.add(audio);
    void audioContext.resume();
  } catch { /* The browser can still play the element at its normal volume. */ }
}
/** Plays a short UI sound and briefly ducks the theme beneath it. */
export function playSound(name: SoundName) {
  preloadSounds();
  startBackgroundMusic();
  const pool = effectPools.get(name) ?? [];
  const audio = pool.find((candidate) => candidate.paused || candidate.ended) ?? prepareAudio(`/sounds/${clips[name]}`);
  if (!pool.includes(audio)) effectPools.set(name, [...pool, audio]);
  audio.currentTime = 0;
  audio.volume = (clipVolumes[name] ?? 1) * levels.effects;
  amplify(audio, boosts[name] ?? 1);
  duckMusic(audio);
  const playback = audio.play();
  void playback?.catch(() => undefined);
  return audio;
}
/** Gives ordinary buttons a quiet, consistent click without overriding purpose-specific sounds. */
export function useGenericButtonSounds() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!button || button.disabled || button.dataset.sound) return;
      playSound("click");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

if (typeof window !== "undefined" && typeof Audio !== "undefined" && !navigator.userAgent.includes("jsdom")) preloadSounds();
