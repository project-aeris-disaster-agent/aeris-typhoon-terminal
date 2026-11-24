/**
 * First-run tutorial: who speaks, what they say, in which language.
 *
 * The two guides come from bagyo-game (bagyogame/src/ui/guides):
 *  - A.E.R.I.S. explains what the dashboard is for.
 *  - Disaster Minds™ points at the control that does it.
 *
 * Each step is one short headline and one or two plain sentences. A step with
 * a `target` rings the element carrying `data-tour="<target>"`; when that
 * element isn't on screen (e.g. the layers card on a phone) the step is left
 * out rather than pointing at nothing.
 */

export const TUTORIAL_LANGS = ["en", "tl", "ceb"] as const;
export type TutorialLang = (typeof TUTORIAL_LANGS)[number];

export const LANG_LABELS: Record<TutorialLang, { short: string; name: string }> = {
  en: { short: "EN", name: "English" },
  tl: { short: "TL", name: "Tagalog" },
  ceb: { short: "BIS", name: "Bisaya" },
};

export type GuideId = "aeris" | "minds";

/** Sprite sheets copied from bagyogame/assets/characters (frames side by side). */
export const GUIDE_SPRITES: Record<
  GuideId,
  {
    src: string;
    frameW: number;
    frameH: number;
    frameCount: number;
    /** Mouth-closed and mouth-open frames, alternated while the guide "talks". */
    rest: number;
    talk: number;
  }
> = {
  // idle, idle-open, talk, talk-closed, thinking, thinking-open, sad, surprised
  aeris: { src: "/assets/guides/aeris.webp", frameW: 545, frameH: 640, frameCount: 8, rest: 3, talk: 2 },
  // idle, idle-open, happy, happy-closed, surprised
  minds: { src: "/assets/guides/minds.webp", frameW: 452, frameH: 560, frameCount: 5, rest: 3, talk: 2 },
};

type Localized = Record<TutorialLang, string>;

export const GUIDE_BIOS: Record<GuideId, { name: string; role: Localized }> = {
  aeris: {
    name: "A.E.R.I.S.",
    role: { en: "Disaster companion", tl: "Katuwang sa sakuna", ceb: "Kauban sa katalagman" },
  },
  minds: {
    name: "Disaster Minds™",
    role: { en: "Volunteer guide", tl: "Gabay na boluntaryo", ceb: "Giya nga boluntaryo" },
  },
};

export type TutorialTarget = "map" | "layers" | "alerts" | "reports" | "live-updates";

export type TutorialStep = {
  id: string;
  who: GuideId;
  target?: TutorialTarget;
  title: Localized;
  text: Localized;
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    who: "aeris",
    title: {
      en: "Welcome to A.E.R.I.S.",
      tl: "Maligayang pagdating sa A.E.R.I.S.",
      ceb: "Maayong pag-abot sa A.E.R.I.S.",
    },
    text: {
      en: "I'm A.E.R.I.S., your disaster companion. This dashboard shows typhoons, floods and community reports for the whole Philippines on one map.",
      tl: "Ako si A.E.R.I.S., ang iyong katuwang sa sakuna. Makikita mo rito sa iisang mapa ang mga bagyo, baha, at ulat ng komunidad sa buong Pilipinas.",
      ceb: "Ako si A.E.R.I.S., imong kauban panahon sa katalagman. Makita nimo dinhi sa usa ka mapa ang mga bagyo, baha, ug mga taho sa komunidad sa tibuok Pilipinas.",
    },
  },
  {
    id: "map",
    who: "minds",
    target: "map",
    title: { en: "The live map", tl: "Ang live na mapa", ceb: "Ang live nga mapa" },
    text: {
      en: "Drag to move, and scroll or pinch to zoom. Each red ping is a report from someone in the community.",
      tl: "I-drag para gumalaw, at mag-scroll o mag-pinch para mag-zoom. Ang bawat pulang tuldok ay ulat mula sa isang tao sa komunidad.",
      ceb: "I-drag aron molihok, ug i-scroll o i-pinch aron mo-zoom. Ang matag pula nga tuldok usa ka taho gikan sa usa ka tawo sa komunidad.",
    },
  },
  {
    id: "layers",
    who: "minds",
    target: "layers",
    title: { en: "Map layers", tl: "Mga layer ng mapa", ceb: "Mga layer sa mapa" },
    text: {
      en: "Turn on flood hazard maps and river water levels here. Quick Views jump straight to a city.",
      tl: "Dito mo bubuksan ang mapa ng panganib sa baha at ang lebel ng tubig sa ilog. Sa Quick Views, diretso ka sa isang lungsod.",
      ceb: "Dinhi nimo ablihan ang mapa sa peligro sa baha ug ang lebel sa tubig sa suba. Sa Quick Views, diretso ka sa usa ka siyudad.",
    },
  },
  {
    id: "alerts",
    who: "aeris",
    target: "alerts",
    title: { en: "Storms and alerts", tl: "Mga bagyo at babala", ceb: "Mga bagyo ug pahimangno" },
    text: {
      en: "Active typhoons, official PAGASA bulletins and the 7-day forecast are on this side. Look here first when a storm is coming.",
      tl: "Nasa gilid na ito ang mga aktibong bagyo, opisyal na bulletin ng PAGASA, at ang 7-araw na forecast. Dito ka unang tumingin kapag may paparating na bagyo.",
      ceb: "Ania niining kilid ang mga aktibong bagyo, opisyal nga bulletin sa PAGASA, ug ang 7 ka adlaw nga forecast. Diri una tan-aw kung naay moabot nga bagyo.",
    },
  },
  {
    id: "reports",
    who: "minds",
    target: "reports",
    title: { en: "Send a report", tl: "Magpadala ng ulat", ceb: "Pagpadala og taho" },
    text: {
      en: "See flooding, a landslide or a blocked road? Open Reports to send one, or to read what people near you are reporting.",
      tl: "May nakikita ka bang baha, pagguho ng lupa, o saradong daan? Buksan ang Reports para magpadala ng ulat o basahin ang ulat ng mga malapit sa iyo.",
      ceb: "Naay nakita nga baha, pagdahili sa yuta, o sirado nga dalan? Ablihi ang Reports aron mopadala og taho o mobasa sa taho sa mga duol nimo.",
    },
  },
  {
    id: "ask",
    who: "aeris",
    target: "live-updates",
    title: { en: "Ask me anything", tl: "Magtanong ka lang", ceb: "Pangutana lang" },
    text: {
      en: "Open Live Updates at the bottom to ask me about the weather where you are, and to watch live news. Stay safe!",
      tl: "Buksan ang Live Updates sa ibaba para magtanong sa akin tungkol sa panahon sa inyong lugar at manood ng live na balita. Mag-ingat kayo!",
      ceb: "Ablihi ang Live Updates sa ubos aron mangutana nako bahin sa panahon sa inyong lugar ug motan-aw og live nga balita. Pag-amping mo!",
    },
  },
];

export const TUTORIAL_UI: Record<
  TutorialLang,
  {
    next: string;
    back: string;
    skip: string;
    done: string;
    step: (n: number, total: number) => string;
    language: string;
    dialog: string;
  }
> = {
  en: {
    next: "Next",
    back: "Back",
    skip: "Skip",
    done: "Let's go",
    step: (n, total) => `Step ${n} of ${total}`,
    language: "Language",
    dialog: "Dashboard tutorial",
  },
  tl: {
    next: "Susunod",
    back: "Bumalik",
    skip: "Laktawan",
    done: "Tara na",
    step: (n, total) => `Hakbang ${n} sa ${total}`,
    language: "Wika",
    dialog: "Gabay sa dashboard",
  },
  ceb: {
    next: "Sunod",
    back: "Balik",
    skip: "Laktawi",
    done: "Tara na",
    step: (n, total) => `Lakang ${n} sa ${total}`,
    language: "Pinulongan",
    dialog: "Giya sa dashboard",
  },
};

/** Best first guess from the browser; the guide's language picker overrides it. */
export function detectTutorialLang(languages: readonly string[] | undefined): TutorialLang {
  for (const raw of languages ?? []) {
    const tag = raw.toLowerCase();
    if (tag.startsWith("ceb") || tag.startsWith("bis")) return "ceb";
    if (tag.startsWith("fil") || tag.startsWith("tl")) return "tl";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}
