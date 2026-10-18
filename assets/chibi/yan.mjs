// 沈砚：Q 版组件（蔚蓝长直 × 连衣裙）。坐标系 300×440。
import { FACES } from './faces.mjs';

const hairBack = `
  <path d="M150 32 C 88 38, 58 100, 62 196 C 64 252, 56 292, 66 310 L234 310 C 244 292, 236 252, 238 196 C 242 100, 212 38, 150 32 Z"
        fill="#35427a" stroke="#46324e" stroke-width="3"/>`;

const head = `
  <circle cx="150" cy="120" r="78" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <circle cx="74" cy="132" r="9" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <circle cx="226" cy="132" r="9" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <path d="M78 112 L68 244 Q78 254 86 244 L88 118 Z" fill="#44548c" stroke="#46324e" stroke-width="3"/>
  <path d="M222 112 L232 244 Q222 254 214 244 L212 118 Z" fill="#44548c" stroke="#46324e" stroke-width="3"/>
  <path d="M76 120 C 70 58, 108 40, 150 40 C 192 40, 230 58, 224 120
           Q216 128 208 112 Q196 126 184 108 Q170 124 156 106 Q150 120 144 106
           Q130 124 116 108 Q104 126 92 112 Q84 128 76 120 Z" fill="#44548c" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>`;

const outfit = `
  <ellipse cx="150" cy="382" rx="62" ry="10" fill="rgba(70,50,78,.22)"/>
  <rect x="131" y="320" width="16" height="46" rx="7" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <rect x="153" y="320" width="16" height="46" rx="7" fill="#ffe7d6" stroke="#46324e" stroke-width="3"/>
  <rect x="131" y="332" width="16" height="32" fill="#fbfbfd" stroke="#46324e" stroke-width="2.5"/>
  <rect x="153" y="332" width="16" height="32" fill="#fbfbfd" stroke="#46324e" stroke-width="2.5"/>
  <rect x="126" y="362" width="26" height="13" rx="6" fill="#8a5a3c" stroke="#46324e" stroke-width="3"/>
  <rect x="152" y="362" width="26" height="13" rx="6" fill="#8a5a3c" stroke="#46324e" stroke-width="3"/>
  <path d="M106 192 Q150 178 194 192 L216 332 Q150 348 84 332 Z" fill="#5164c9" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M127 190 Q150 214 173 190 Q150 228 127 190 Z" fill="#fbfbfd" stroke="#46324e" stroke-width="3" stroke-linejoin="round"/>
  <rect x="102" y="258" width="96" height="13" rx="6" fill="#fbfbfd" stroke="#46324e" stroke-width="2.5"/>
  <path d="M112 265 l-14 -7 l0 14 Z M112 265 l14 -7 l0 14 Z" fill="#e0586e" stroke="#46324e" stroke-width="2"/>
  <path d="M112 202 Q96 238 98 270" stroke="#46324e" stroke-width="19" fill="none" stroke-linecap="round"/>
  <path d="M112 202 Q96 238 98 270" stroke="#5164c9" stroke-width="13" fill="none" stroke-linecap="round"/>
  <path d="M188 202 Q204 238 202 270" stroke="#46324e" stroke-width="19" fill="none" stroke-linecap="round"/>
  <path d="M188 202 Q204 238 202 270" stroke="#5164c9" stroke-width="13" fill="none" stroke-linecap="round"/>
  <circle cx="98" cy="274" r="7.5" fill="#ffe7d6" stroke="#46324e" stroke-width="2.5"/>
  <circle cx="202" cy="274" r="7.5" fill="#ffe7d6" stroke="#46324e" stroke-width="2.5"/>`;

export const IRIS = '#8a5fc9';

export function render(expr = 'usual') {
  const face = FACES[expr] ?? FACES.usual;
  return `<svg viewBox="0 0 300 440" xmlns="http://www.w3.org/2000/svg">
  <g style="--iris:${IRIS}">${hairBack}${outfit}${head}${face}</g>
</svg>`;
}
