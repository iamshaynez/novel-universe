// 场景配方：黄昏天台（参数 time=dusk|night 派生）。
// 返回 { svg, effects }；svg 为 1280×720 全屏背景，效果由播放器叠加。
export function render(params = {}) {
  const night = params.time === 'night';
  const skyTop = night ? '#151030' : '#3b2560';
  const skyMid = night ? '#2c2458' : '#93407a';
  const skyLow = night ? '#3a3570' : '#e2795a';
  const skyBot = night ? '#4a4484' : '#ffd9a3';
  const sunOpacity = night ? 0.25 : 1;

  return {
    effects: [],
    svg: `
<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="r-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${skyTop}"/><stop offset="0.38" stop-color="${skyMid}"/>
      <stop offset="0.66" stop-color="${skyLow}"/><stop offset="1" stop-color="${skyBot}"/>
    </linearGradient>
    <radialGradient id="r-sun" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff6dc" stop-opacity="0.95"/>
      <stop offset="0.35" stop-color="#ffd9a0" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="r-floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#33204e"/><stop offset="1" stop-color="#120a20"/>
    </linearGradient>
    <radialGradient id="r-vig" cx="0.5" cy="0.46" r="0.75">
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#0a0518" stop-opacity="0.55"/>
    </radialGradient>
    <pattern id="r-mesh" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="26" stroke="#221338" stroke-width="1.4"/>
      <line x1="0" y1="0" x2="26" y2="0" stroke="#221338" stroke-width="1.4"/>
    </pattern>
    <style>
      .r-mote { animation: r-tw 3.2s ease-in-out infinite alternate; }
      .r-mote:nth-of-type(2){animation-delay:.6s}.r-mote:nth-of-type(3){animation-delay:1.2s}
      .r-mote:nth-of-type(4){animation-delay:1.8s}.r-mote:nth-of-type(5){animation-delay:.3s}
      .r-mote:nth-of-type(6){animation-delay:.9s}.r-mote:nth-of-type(7){animation-delay:2.1s}
      .r-mote:nth-of-type(8){animation-delay:1.5s}
      @keyframes r-tw { from {opacity:.15;} to {opacity:.95; transform:translateY(-14px);} }
    </style>
  </defs>

  <rect width="1280" height="548" fill="url(#r-sky)"/>
  <circle cx="985" cy="435" r="185" fill="url(#r-sun)" opacity="${sunOpacity}"/>
  <circle cx="985" cy="435" r="46" fill="#fff3d2" opacity="${sunOpacity}"/>

  <g opacity="${night ? 0.5 : 1}">
    <ellipse cx="250" cy="312" rx="132" ry="14" fill="#ffb08e" opacity=".5"/>
    <ellipse cx="300" cy="298" rx="80" ry="10" fill="#ffd3ae" opacity=".55"/>
    <ellipse cx="470" cy="352" rx="92" ry="10" fill="#ff9877" opacity=".4"/>
    <ellipse cx="760" cy="262" rx="112" ry="12" fill="#ff9877" opacity=".45"/>
    <ellipse cx="820" cy="248" rx="60" ry="8" fill="#ffc4a0" opacity=".5"/>
    <ellipse cx="1060" cy="330" rx="140" ry="13" fill="#ffbe97" opacity=".5"/>
    <ellipse cx="1150" cy="310" rx="70" ry="9" fill="#ffd9b6" opacity=".45"/>
  </g>
  <g stroke="#3b2456" stroke-width="3" fill="none" stroke-linecap="round" opacity="${night ? 0.6 : 1}">
    <path d="M300 252 q8 -7 16 0 q8 -7 16 0"/>
    <path d="M372 224 q6 -5 12 0 q6 -5 12 0" stroke-width="2.4"/>
    <path d="M340 276 q5 -4 10 0 q5 -4 10 0" stroke-width="2"/>
  </g>

  <path d="M0 548 L0 486 L58 486 L58 502 L104 502 L104 470 L150 470 L150 500 L210 500 L210 462 L262 462
           L262 496 L330 496 L330 474 L392 474 L392 502 L470 502 L470 480 L560 480 L560 500 L660 500
           L660 472 L740 472 L740 498 L820 498 L820 478 L900 478 L900 502 L980 502 L980 470 L1050 470
           L1050 498 L1130 498 L1130 474 L1200 474 L1200 500 L1280 500 L1280 548 Z" fill="#6a4488" opacity=".75"/>
  <g fill="#3a2456">
    <path d="M0 548 L0 430 L64 430 L64 412 L92 412 L92 430 L120 430 L120 468 L188 468 L188 440 L262 440 L262 486 L330 486 L330 462 L392 462 L392 496 L1280 496 L1280 548 Z"/>
    <path d="M936 548 L936 448 L1002 448 L1002 470 L1080 470 L1080 442 L1160 442 L1160 474 L1280 474 L1280 548 Z"/>
    <line x1="70" y1="412" x2="70" y2="386" stroke="#3a2456" stroke-width="4"/>
    <line x1="1118" y1="442" x2="1118" y2="410" stroke="#3a2456" stroke-width="4"/>
  </g>
  <g fill="#ffcf96" opacity=".55">
    <rect x="20" y="452" width="7" height="9"/><rect x="40" y="478" width="7" height="9"/>
    <rect x="140" y="480" width="7" height="9"/><rect x="204" y="454" width="7" height="9"/>
    <rect x="300" y="474" width="7" height="9"/><rect x="960" y="466" width="7" height="9"/>
    <rect x="1030" y="484" width="7" height="9"/><rect x="1120" y="458" width="7" height="9"/>
    <rect x="1200" y="486" width="7" height="9"/><rect x="1250" y="470" width="7" height="9"/>
  </g>

  <rect x="0" y="352" width="1280" height="193" fill="url(#r-mesh)" opacity=".5"/>
  <g fill="#1a0f2e">
    <rect x="0" y="352" width="1280" height="6"/><rect x="0" y="428" width="1280" height="6"/>
    <rect x="0" y="500" width="1280" height="7"/>
    <rect x="20" y="348" width="7" height="197"/><rect x="180" y="348" width="7" height="197"/>
    <rect x="340" y="348" width="7" height="197"/><rect x="500" y="348" width="7" height="197"/>
    <rect x="660" y="348" width="7" height="197"/><rect x="820" y="348" width="7" height="197"/>
    <rect x="980" y="348" width="7" height="197"/><rect x="1140" y="348" width="7" height="197"/>
    <rect x="1268" y="348" width="7" height="197"/>
  </g>

  <rect x="0" y="545" width="1280" height="175" fill="url(#r-floor)"/>
  <line x1="0" y1="545" x2="1280" y2="545" stroke="#ffb076" stroke-width="1.5" opacity=".3"/>
  <rect x="60" y="430" width="150" height="115" fill="#190e2c"/>
  <line x1="60" y1="430" x2="210" y2="430" stroke="#3a2456" stroke-width="2" opacity=".8"/>
  <circle cx="135" cy="470" r="26" fill="#140c24" stroke="#2b1a44" stroke-width="3"/>
  <path d="M135 470 L135 450 M135 470 L152 480 M135 470 L118 480" stroke="#2b1a44" stroke-width="4"/>
  <rect x="232" y="412" width="14" height="133" fill="#170c28"/>
  <rect x="254" y="434" width="10" height="111" fill="#170c28"/>

  <g fill="#ffdcae">
    <circle class="r-mote" cx="300" cy="200" r="3"/><circle class="r-mote" cx="420" cy="152" r="2"/>
    <circle class="r-mote" cx="560" cy="120" r="2"/><circle class="r-mote" cx="820" cy="122" r="2.5"/>
    <circle class="r-mote" cx="900" cy="182" r="2"/><circle class="r-mote" cx="1052" cy="260" r="2.4"/>
    <circle class="r-mote" cx="1150" cy="150" r="2"/><circle class="r-mote" cx="204" cy="332" r="2.5"/>
  </g>

  <rect width="1280" height="720" fill="url(#r-vig)" pointer-events="none"/>
</svg>`,
  };
}
