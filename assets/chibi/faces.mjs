// Q 版脸部组件（瞳色通过 --iris CSS 变量注入，与 tokens.json 对齐）。
const iris = 'style="fill:var(--iris,#4a7fc1)"';

export const FACES = {
  usual: `
    <ellipse cx="115" cy="154" rx="20" ry="26" fill="#fff" stroke="#46324e" stroke-width="3"/>
    <ellipse cx="185" cy="154" rx="20" ry="26" fill="#fff" stroke="#46324e" stroke-width="3"/>
    <circle cx="115" cy="157" r="16.5" ${iris}/><circle cx="185" cy="157" r="16.5" ${iris}/>
    <circle cx="115" cy="159" r="8" fill="#1e2745"/><circle cx="185" cy="159" r="8" fill="#1e2745"/>
    <circle cx="109" cy="149" r="6" fill="#fff"/><circle cx="179" cy="149" r="6" fill="#fff"/>
    <circle cx="121" cy="165" r="3" fill="#fff" opacity=".9"/><circle cx="191" cy="165" r="3" fill="#fff" opacity=".9"/>
    <path d="M93 137 Q115 124 137 137" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M163 137 Q185 124 207 137" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M101 115 Q115 108 129 115" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M171 115 Q185 108 199 115" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M140 189 Q150 197 160 189" stroke="#c25b70" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="100" cy="178" rx="13" ry="7.5" fill="#ff9d9d" opacity=".5"/>
    <ellipse cx="200" cy="178" rx="13" ry="7.5" fill="#ff9d9d" opacity=".5"/>`,
  smile: `
    <path d="M95 150 Q115 134 135 150" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M165 150 Q185 134 205 150" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M101 111 Q115 103 129 111" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M171 111 Q185 103 199 111" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M138 185 C 142 200, 158 200, 162 185 Q150 193 138 185 Z" fill="#a84a62" stroke="#46324e" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="98" cy="178" rx="16" ry="9" fill="#ff9d9d" opacity=".65"/>
    <ellipse cx="202" cy="178" rx="16" ry="9" fill="#ff9d9d" opacity=".65"/>
    <path d="M86 118 l4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4 Z" fill="#ffd76e" stroke="#d9a83e" stroke-width="1.5"/>
    <path d="M214 118 l4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4 Z" fill="#ffd76e" stroke="#d9a83e" stroke-width="1.5"/>`,
  shy: `
    <path d="M95 152 Q115 141 135 152" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M165 152 Q185 141 205 152" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="112" cy="152" r="8.5" ${iris}/><circle cx="178" cy="152" r="8.5" ${iris}/>
    <circle cx="109" cy="149" r="3" fill="#fff"/><circle cx="175" cy="149" r="3" fill="#fff"/>
    <path d="M103 112 Q115 106 127 112" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M173 112 Q185 106 197 112" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M143 190 Q150 186 157 190" stroke="#c25b70" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="96" cy="178" rx="20" ry="11" fill="#ff8f9c" opacity=".75"/>
    <ellipse cx="204" cy="178" rx="20" ry="11" fill="#ff8f9c" opacity=".75"/>
    <g stroke="#e86a7a" stroke-width="2.5" stroke-linecap="round" opacity=".8">
      <path d="M84 172 l10 14"/><path d="M94 170 l10 14"/>
      <path d="M216 172 l-10 14"/><path d="M206 170 l-10 14"/>
    </g>
    <path d="M226 96 q11 15 0 23 q-11 -8 0 -23 Z" fill="#a8dcff" stroke="#6fb4de" stroke-width="2"/>`,
  surprise: `
    <ellipse cx="115" cy="154" rx="22" ry="29" fill="#fff" stroke="#46324e" stroke-width="3"/>
    <ellipse cx="185" cy="154" rx="22" ry="29" fill="#fff" stroke="#46324e" stroke-width="3"/>
    <circle cx="115" cy="157" r="10.5" ${iris}/><circle cx="185" cy="157" r="10.5" ${iris}/>
    <circle cx="111" cy="152" r="4" fill="#fff"/><circle cx="181" cy="152" r="4" fill="#fff"/>
    <path d="M95 136 Q115 124 135 136" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M165 136 Q185 124 205 136" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M99 106 Q115 98 131 106" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M169 106 Q185 98 201 106" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <ellipse cx="150" cy="193" rx="8.5" ry="11.5" fill="#a84a62" stroke="#46324e" stroke-width="2.5"/>
    <ellipse cx="100" cy="180" rx="12" ry="7" fill="#ff9d9d" opacity=".45"/>
    <ellipse cx="200" cy="180" rx="12" ry="7" fill="#ff9d9d" opacity=".45"/>
    <g stroke="#46324e" stroke-width="4" stroke-linecap="round">
      <path d="M108 52 L100 32"/><path d="M146 46 L146 24"/><path d="M184 54 L192 34"/>
    </g>
    <path d="M228 100 q12 16 0 25 q-12 -9 0 -25 Z" fill="#a8dcff" stroke="#6fb4de" stroke-width="2"/>`,
  angry: `
    <ellipse cx="115" cy="154" rx="20" ry="26" fill="#fff" stroke="#46324e" stroke-width="3"/>
    <ellipse cx="185" cy="154" rx="20" ry="26" fill="#fff" stroke="#46324e" stroke-width="3"/>
    <circle cx="115" cy="156" r="14" ${iris}/><circle cx="185" cy="156" r="14" ${iris}/>
    <circle cx="109" cy="149" r="5" fill="#fff"/><circle cx="179" cy="149" r="5" fill="#fff"/>
    <path d="M93 135 Q115 124 137 133" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M163 133 Q185 124 207 135" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M99 108 L131 122" stroke="#5a4660" stroke-width="6" stroke-linecap="round"/>
    <path d="M201 108 L169 122" stroke="#5a4660" stroke-width="6" stroke-linecap="round"/>
    <path d="M140 192 Q147 186 154 192 Q161 198 168 192" stroke="#c25b70" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <ellipse cx="96" cy="178" rx="15" ry="9" fill="#ff7f8c" opacity=".6"/>
    <ellipse cx="204" cy="178" rx="15" ry="9" fill="#ff7f8c" opacity=".6"/>
    <g stroke="#e04848" stroke-width="4.5" stroke-linecap="round">
      <path d="M212 44 L224 56"/><path d="M224 44 L212 56"/>
      <path d="M206 62 L218 74"/><path d="M218 62 L206 74"/>
    </g>`,
  cry: `
    <path d="M100 118 Q114 110 128 114" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M172 114 Q186 110 200 118" stroke="#5a4660" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M95 146 Q115 158 135 146" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M165 146 Q185 158 205 146" stroke="#46324e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M106 160 q12 16 0 26 q-12 -10 0 -26 Z" fill="#a8dcff" stroke="#6fb4de" stroke-width="2"/>
    <path d="M194 160 q12 16 0 26 q-12 -10 0 -26 Z" fill="#a8dcff" stroke="#6fb4de" stroke-width="2"/>
    <path d="M138 184 Q150 208 162 184 Q150 196 138 184 Z" fill="#a84a62" stroke="#46324e" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="98" cy="182" rx="13" ry="8" fill="#ff9d9d" opacity=".45"/>
    <ellipse cx="202" cy="182" rx="13" ry="8" fill="#ff9d9d" opacity=".45"/>`,
};
