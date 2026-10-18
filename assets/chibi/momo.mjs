// 小桃：Q 版组件（hairBack + outfit + head + face）。坐标系 300×440。
import { FACES } from './faces.mjs';

const hairBack = `
  <path d="M74 98 C 22 132, 12 214, 32 272 C 40 292, 62 288, 63 266 C 68 212, 76 152, 86 114 Z" fill="#e88aa4" stroke="#46324e" stroke-width="3"/>
  <path d="M226 98 C 278 132, 288 214, 268 272 C 260 292, 238 288, 237 266 C 232 212, 224 152, 214 114 Z" fill="#e88aa4" stroke="#46324e" stroke-width="3"/>
  <circle cx="150" cy="116" r="84" fill="#e88aa4" stroke="#46324e" stroke-width="3"/>`;

const head = `
  <circle cx="74" cy="132" r="9" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <circle cx="226" cy="132" r="9" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <circle cx="150" cy="120" r="78" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <path d="M76 114 C 62 152, 62 202, 72 238 Q80 232 82 202 Q80 158 86 122 Z" fill="#f7a8bd" stroke="#46324e" stroke-width="3"/>
  <path d="M224 114 C 238 152, 238 202, 228 238 Q220 232 218 202 Q220 158 214 122 Z" fill="#f7a8bd" stroke="#46324e" stroke-width="3"/>
  <path d="M74 120 C 68 58, 108 40, 150 40 C 192 40, 232 58, 226 120
           Q218 130 210 112 Q198 128 186 108 Q172 126 158 106 Q150 122 142 106
           Q128 126 114 108 Q102 128 90 112 Q82 130 74 120 Z" fill="#f7a8bd" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M150 42 Q140 16 166 10 Q152 26 158 44 Z" fill="#f7a8bd" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M78 102 l-13 -8 l0 17 Z M78 102 l13 -8 l0 17 Z" fill="#e0586e" stroke="#46324e" stroke-width="2"/>
  <path d="M222 102 l-13 -8 l0 17 Z M222 102 l13 -8 l0 17 Z" fill="#e0586e" stroke="#46324e" stroke-width="2"/>`;

const outfit = `
  <ellipse cx="150" cy="382" rx="62" ry="10" fill="rgba(70,50,78,.22)"/>
  <rect x="131" y="320" width="16" height="46" rx="7" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <rect x="153" y="320" width="16" height="46" rx="7" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <rect x="131" y="344" width="16" height="20" fill="#fbfbfd" stroke="#46324e" stroke-width="2.5"/>
  <rect x="153" y="344" width="16" height="20" fill="#fbfbfd" stroke="#46324e" stroke-width="2.5"/>
  <rect x="126" y="362" width="26" height="14" rx="6" fill="#d9576e" stroke="#46324e" stroke-width="3"/>
  <rect x="152" y="362" width="26" height="14" rx="6" fill="#d9576e" stroke="#46324e" stroke-width="3"/>
  <path d="M100 286 L200 286 L214 332 Q150 346 86 332 Z" fill="#2f3e68" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M125 292 L118 336 M150 294 L150 342 M175 292 L182 336" stroke="#243154" stroke-width="2.5"/>
  <path d="M108 190 Q150 178 192 190 L200 292 Q150 306 100 292 Z" fill="#fbfbfd" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M126 190 L150 210 L174 190 L184 198 L150 224 L116 198 Z" fill="#2f3e68" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M150 216 L134 206 L134 226 Z M150 216 L166 206 L166 226 Z" fill="#e0586e" stroke="#46324e" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M112 202 Q96 238 98 270" stroke="#46324e" stroke-width="19" fill="none" stroke-linecap="round"/>
  <path d="M112 202 Q96 238 98 270" stroke="#fbfbfd" stroke-width="13" fill="none" stroke-linecap="round"/>
  <path d="M188 202 Q204 238 202 270" stroke="#46324e" stroke-width="19" fill="none" stroke-linecap="round"/>
  <path d="M188 202 Q204 238 202 270" stroke="#fbfbfd" stroke-width="13" fill="none" stroke-linecap="round"/>
  <circle cx="98" cy="274" r="7.5" fill="#ffe7d6" stroke="#46324e" stroke-width="2.5"/>
  <circle cx="202" cy="274" r="7.5" fill="#ffe7d6" stroke="#46324e" stroke-width="2.5"/>`;

export const IRIS = '#4a7fc1';

export function render(expr = 'usual') {
  const face = FACES[expr] ?? FACES.usual;
  return `<svg viewBox="0 0 300 440" xmlns="http://www.w3.org/2000/svg">
  <g style="--iris:${IRIS}">${hairBack}${outfit}${head}${face}</g>
</svg>`;
}
