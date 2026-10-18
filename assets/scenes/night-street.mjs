// 场景配方：雨夜长街·夜半茶寮。effects: ['rain'] 由播放器叠加雨幕层。
export function render() {
  return {
    effects: ['rain'],
    svg: `
<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ns-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1424"/><stop offset="1" stop-color="#0e2033"/>
    </linearGradient>
    <radialGradient id="ns-warm" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffd9a0" stop-opacity="0.55"/>
      <stop offset="0.4" stop-color="#ffc46b" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffc46b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ns-cone" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffcd82" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#ffcd82" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="ns-road" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a1322"/><stop offset="1" stop-color="#060b16"/>
    </linearGradient>
    <filter id="ns-blur"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="ns-neon" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <style>
      .ns-neon { animation: ns-flick 6s infinite; }
      .ns-glow { animation: ns-breathe 4s ease-in-out infinite alternate; transform-box: fill-box; transform-origin: center; }
      @keyframes ns-flick { 0%,41%,43%,45%,46%,78%,80.5%,100%{opacity:1;} 42%{opacity:.35;} 45%{opacity:.5;} 79%{opacity:.2;} }
      @keyframes ns-breathe { from{opacity:.85;} to{opacity:1;} }
    </style>
  </defs>

  <rect width="1280" height="720" fill="url(#ns-bg)"/>
  <g fill="#bcd8ff" opacity=".5">
    <circle cx="120" cy="60" r="1.4"/><circle cx="300" cy="36" r="1"/><circle cx="520" cy="70" r="1.2"/>
    <circle cx="700" cy="30" r="1"/><circle cx="900" cy="56" r="1.4"/><circle cx="1150" cy="40" r="1.1"/>
  </g>

  <g>
    <path d="M0 560 L0 66 L250 66 L250 560 Z" fill="#0d1526"/>
    <g fill="#ffca7a" opacity=".75">
      <rect x="30" y="100" width="10" height="13"/><rect x="70" y="100" width="10" height="13"/>
      <rect x="110" y="160" width="10" height="13"/><rect x="150" y="100" width="10" height="13"/>
      <rect x="30" y="220" width="10" height="13"/><rect x="110" y="280" width="10" height="13"/>
      <rect x="190" y="220" width="10" height="13"/><rect x="70" y="340" width="10" height="13"/>
      <rect x="150" y="400" width="10" height="13"/><rect x="30" y="460" width="10" height="13"/>
      <rect x="190" y="460" width="10" height="13"/>
    </g>
    <g fill="#7de3ff" opacity=".55">
      <rect x="70" y="160" width="10" height="13"/><rect x="190" y="340" width="10" height="13"/>
      <rect x="110" y="460" width="10" height="13"/>
    </g>
    <g class="ns-neon" filter="url(#ns-neon)">
      <rect x="176" y="128" width="46" height="188" rx="7" fill="rgba(125,227,255,.07)" stroke="#7de3ff" stroke-width="2.5"/>
      <g fill="#c8f4ff" font-family="serif" font-size="30" text-anchor="middle">
        <text x="199" y="168">夜</text><text x="199" y="208">半</text>
        <text x="199" y="248">茶</text><text x="199" y="288">寮</text>
      </g>
    </g>
  </g>

  <g>
    <path d="M1000 560 L1000 108 L1280 108 L1280 560 Z" fill="#0c1220"/>
    <g fill="#ffca7a" opacity=".7">
      <rect x="1030" y="140" width="10" height="13"/><rect x="1070" y="200" width="10" height="13"/>
      <rect x="1110" y="140" width="10" height="13"/><rect x="1190" y="260" width="10" height="13"/>
      <rect x="1150" y="320" width="10" height="13"/><rect x="1230" y="140" width="10" height="13"/>
      <rect x="1030" y="380" width="10" height="13"/><rect x="1190" y="440" width="10" height="13"/>
    </g>
    <g fill="#7de3ff" opacity=".5">
      <rect x="1150" y="200" width="10" height="13"/><rect x="1070" y="440" width="10" height="13"/>
    </g>
  </g>

  <rect x="240" y="470" width="762" height="92" fill="#0a111d"/>
  <circle cx="330" cy="458" r="16" fill="#0a111d"/>
  <rect x="560" y="452" width="40" height="20" fill="#0a111d"/>

  <g>
    <rect x="884" y="230" width="10" height="332" fill="#182334"/>
    <path d="M889 240 Q889 196 845 196" stroke="#182334" stroke-width="10" fill="none" stroke-linecap="round"/>
    <rect x="824" y="192" width="42" height="15" rx="7" fill="#1f2b3e"/>
    <polygon points="828,207 862,207 944,560 748,560" fill="url(#ns-cone)"/>
    <circle class="ns-glow" cx="845" cy="216" r="112" fill="url(#ns-warm)"/>
    <ellipse cx="845" cy="211" rx="16" ry="8" fill="#ffe9c4"/>
  </g>

  <g>
    <circle cx="843" cy="492" r="11" fill="#0c1526"/>
    <path d="M833 504 L853 504 L857 558 L829 558 Z" fill="#0c1526"/>
    <path d="M854 504 Q862 526 860 556" stroke="rgba(255,215,150,.6)" stroke-width="2" fill="none"/>
  </g>

  <rect x="0" y="558" width="1280" height="162" fill="url(#ns-road)"/>
  <line x1="0" y1="560" x2="1280" y2="560" stroke="rgba(160,200,255,.16)" stroke-width="1.5"/>
  <g fill="rgba(200,220,255,.10)">
    <rect x="60" y="640" width="58" height="6" rx="3"/><rect x="244" y="640" width="58" height="6" rx="3"/>
    <rect x="428" y="640" width="58" height="6" rx="3"/><rect x="612" y="640" width="58" height="6" rx="3"/>
    <rect x="796" y="640" width="58" height="6" rx="3"/><rect x="980" y="640" width="58" height="6" rx="3"/>
    <rect x="1164" y="640" width="58" height="6" rx="3"/>
  </g>
  <ellipse cx="845" cy="563" rx="102" ry="11" fill="rgba(255,205,130,.26)"/>
  <ellipse cx="845" cy="600" rx="95" ry="13" fill="rgba(255,205,130,.16)"/>
  <rect x="832" y="560" width="26" height="86" fill="rgba(255,205,130,.12)" filter="url(#ns-blur)"/>
</svg>`,
  };
}
