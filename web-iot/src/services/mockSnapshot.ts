/**
 * Generates the simulated "camera capture" as an inline SVG data URL.
 * The real device returns a JPEG from GET /api/snapshot.jpg; the mock returns this
 * illustration instead so the demo never depends on a webcam or remote images.
 */
export interface SceneInput {
  capturedAt: Date;
  subject: 'none' | 'dog' | 'cat' | 'person' | 'other';
  bowlG: number;
}

function dog(): string {
  return `
  <g transform="translate(372 118)">
    <ellipse cx="60" cy="168" rx="92" ry="14" fill="#000" opacity=".12"/>
    <path d="M-10 170 C-14 110 10 70 60 70 C110 70 134 110 130 170 Z" fill="#c98b52"/>
    <path d="M28 170 C26 130 40 104 60 104 C80 104 94 130 92 170 Z" fill="#f2dcc0"/>
    <circle cx="60" cy="52" r="46" fill="#c98b52"/>
    <path d="M18 30 C0 34 -6 76 8 92 C20 84 26 54 26 40 Z" fill="#8a5a32"/>
    <path d="M102 30 C120 34 126 76 112 92 C100 84 94 54 94 40 Z" fill="#8a5a32"/>
    <ellipse cx="60" cy="70" rx="26" ry="20" fill="#f2dcc0"/>
    <circle cx="44" cy="46" r="5.5" fill="#2b2420"/><circle cx="76" cy="46" r="5.5" fill="#2b2420"/>
    <circle cx="46" cy="44" r="1.6" fill="#fff"/><circle cx="78" cy="44" r="1.6" fill="#fff"/>
    <ellipse cx="60" cy="62" rx="8" ry="6" fill="#2b2420"/>
    <path d="M60 68 v6 M52 76 q8 6 16 0" stroke="#2b2420" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M56 80 q4 10 8 0" fill="#e47a7a"/>
  </g>`;
}

function cat(): string {
  return `
  <g transform="translate(380 122)">
    <ellipse cx="56" cy="164" rx="84" ry="13" fill="#000" opacity=".12"/>
    <path d="M118 150 C170 140 170 80 150 70" stroke="#7d7d86" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M-4 166 C-8 110 14 76 56 76 C98 76 120 110 116 166 Z" fill="#8d8d96"/>
    <path d="M34 166 C32 132 42 112 56 112 C70 112 80 132 78 166 Z" fill="#e9e6ea"/>
    <path d="M14 30 L22 -6 L44 18 Z" fill="#8d8d96"/><path d="M98 30 L90 -6 L68 18 Z" fill="#8d8d96"/>
    <path d="M22 22 L25 6 L36 18 Z" fill="#f0b8c0"/><path d="M90 22 L87 6 L76 18 Z" fill="#f0b8c0"/>
    <ellipse cx="56" cy="50" rx="46" ry="40" fill="#8d8d96"/>
    <path d="M40 18 l4 12 M56 14 v14 M72 18 l-4 12" stroke="#6c6c74" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="38" cy="48" rx="7" ry="8" fill="#d8e3a0"/><ellipse cx="74" cy="48" rx="7" ry="8" fill="#d8e3a0"/>
    <ellipse cx="38" cy="48" rx="2.4" ry="7" fill="#2b2420"/><ellipse cx="74" cy="48" rx="2.4" ry="7" fill="#2b2420"/>
    <path d="M51 62 h10 l-5 6 z" fill="#e48a96"/>
    <path d="M56 68 q-6 6 -11 3 M56 68 q6 6 11 3" stroke="#2b2420" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M30 64 h-24 M30 70 l-22 6 M82 64 h24 M82 70 l22 6" stroke="#f4f4f4" stroke-width="1.6" stroke-linecap="round"/>
  </g>`;
}

function person(): string {
  return `
  <g transform="translate(420 40)">
    <path d="M40 -10 C40 40 30 80 46 120 L96 120 C104 80 96 40 100 -10 Z" fill="#5b7fa6"/>
    <path d="M52 118 C40 150 40 176 66 186 C92 192 104 170 98 140 L96 118 Z" fill="#e8b996"/>
    <path d="M58 182 q-4 14 6 18 M70 186 q0 14 8 16 M82 182 q6 12 12 12" stroke="#d4a17e" stroke-width="7" stroke-linecap="round" fill="none"/>
  </g>`;
}

function shadow(): string {
  return `<ellipse cx="470" cy="250" rx="140" ry="60" fill="#3a3530" opacity=".18"/>
  <path d="M330 40 L620 40 L560 300 L380 300 Z" fill="#fff" opacity=".10"/>`;
}

export function renderScene({ capturedAt, subject, bowlG }: SceneInput): string {
  const fill = Math.max(0, Math.min(1, bowlG / 80));
  const kibble: string[] = [];
  const count = Math.round(fill * 34);
  for (let k = 0; k < count; k++) {
    const x = 214 + ((k * 37) % 120);
    const y = 262 - Math.floor(k / 8) * 5 - ((k * 13) % 4);
    kibble.push(`<ellipse cx="${x}" cy="${y}" rx="6" ry="4" fill="${k % 3 ? '#a86a34' : '#8c5427'}"/>`);
  }
  const subjectSvg =
    subject === 'dog' ? dog() : subject === 'cat' ? cat() : subject === 'person' ? person() : subject === 'other' ? shadow() : '';
  const ts = capturedAt.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".38"/></radialGradient>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe6d6"/><stop offset="1" stop-color="#e3d6bf"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a982"/><stop offset="1" stop-color="#b08c63"/></linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#wall)"/>
  <rect x="0" y="210" width="640" height="150" fill="url(#floor)"/>
  <g stroke="#a98660" stroke-width="2" opacity=".5"><path d="M0 250 H640 M0 300 H640"/><path d="M120 210 L60 360 M320 210 V360 M520 210 L580 360"/></g>
  <rect x="40" y="40" width="120" height="90" rx="6" fill="#d8ccb6"/><rect x="48" y="48" width="104" height="74" rx="4" fill="#bcd2c2"/>
  <path d="M60 110 l20 -26 l16 18 l12 -10 l26 18 z" fill="#8fb19a"/>
  <rect x="150" y="150" width="86" height="96" rx="10" fill="#f7f4ee" stroke="#d9d0c2" stroke-width="2"/>
  <rect x="178" y="230" width="30" height="22" rx="4" fill="#d9d0c2"/>
  <ellipse cx="275" cy="276" rx="92" ry="20" fill="#000" opacity=".12"/>
  <path d="M190 252 L360 252 L344 286 L206 286 Z" fill="#4f7a5f"/>
  <ellipse cx="275" cy="252" rx="85" ry="14" fill="#5f8d70"/>
  <ellipse cx="275" cy="254" rx="72" ry="10" fill="#3d5c48"/>
  ${kibble.join('')}
  <text x="275" y="276" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="#e8f0ea">PAW</text>
  ${subjectSvg}
  <rect width="640" height="360" fill="url(#vig)"/>
  <rect x="14" y="14" width="96" height="24" rx="12" fill="#000" opacity=".45"/>
  <circle cx="30" cy="26" r="5" fill="#f0a640"/>
  <text x="42" y="31" font-family="monospace" font-size="13" font-weight="700" fill="#fff">SIMULATED</text>
  <text x="626" y="346" text-anchor="end" font-family="monospace" font-size="13" fill="#fff" opacity=".9">${ts}  QVGA 320x240</text>
  <text x="14" y="346" font-family="monospace" font-size="13" fill="#fff" opacity=".9">PAWPILOT-CAM</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
