import s from "./Backdrop.module.css";

/**
 * Night landscape behind the shell: soft sky glows, a few stars, distant
 * mountains and pines along the bottom. Static SVG (no animation, no blur
 * filter), so it costs nothing while files are processed. Pages with their
 * own background simply cover it.
 */
export function Backdrop() {
  return (
    <div className={s.backdrop} aria-hidden="true">
      <svg className={s.scene} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="bd-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#152234" />
            <stop offset="1" stopColor="#0c131d" />
          </linearGradient>
          <linearGradient id="bd-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d1520" />
            <stop offset="1" stopColor="#080c12" />
          </linearGradient>
        </defs>
        <g fill="#a9c6e8">
          {STARS.map(([x, y, r, o], i) => (
            <circle key={i} cx={x} cy={y} r={r} opacity={o} />
          ))}
        </g>
        <path
          fill="url(#bd-far)"
          opacity="0.75"
          d="M0 640 L120 590 L210 612 L330 540 L430 575 L560 505 L680 560 L790 520 L900 568 L1030 488 L1150 540 L1260 470 L1380 525 L1490 492 L1600 530 L1600 900 L0 900 Z"
        />
        <path
          fill="url(#bd-near)"
          d="M0 735 L150 700 L300 722 L460 680 L640 712 L820 676 L1000 708 L1180 668 L1360 700 L1600 672 L1600 900 L0 900 Z"
        />
        <g fill="#070b11">
          {PINES.map(([x, h], i) => (
            <path key={i} d={`M${x} ${712 - h} L${x - h * 0.22} ${712} L${x + h * 0.22} ${712} Z`} />
          ))}
          <rect x="0" y="710" width="1600" height="190" />
        </g>
      </svg>
      <svg className={s.waves} viewBox="0 0 240 420" preserveAspectRatio="none">
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M-20 ${420 - i * 18} C 60 ${330 - i * 22}, 120 ${250 - i * 14}, 260 ${120 - i * 26}`} fill="none" stroke="currentColor" strokeWidth="1" opacity={0.5 - i * 0.1} />
        ))}
      </svg>
    </div>
  );
}

// [x, y, radius, opacity]: a sparse, irregular sky.
const STARS: [number, number, number, number][] = [
  [120, 80, 1.1, 0.5], [260, 160, 0.8, 0.35], [410, 60, 1, 0.4], [530, 210, 0.7, 0.3], [700, 110, 1.2, 0.45],
  [860, 40, 0.8, 0.35], [990, 170, 1, 0.4], [1120, 90, 0.7, 0.3], [1260, 210, 1.1, 0.45], [1390, 70, 0.9, 0.35],
  [1510, 150, 1.2, 0.4], [330, 300, 0.7, 0.25], [780, 280, 0.8, 0.25], [1180, 330, 0.7, 0.2], [1450, 300, 0.8, 0.25],
];

// [x, height]: pines on the right, thinning out to the left.
const PINES: [number, number][] = [
  [1180, 70], [1215, 96], [1248, 64], [1290, 118], [1330, 84], [1372, 140], [1410, 96], [1452, 160], [1496, 110], [1540, 176], [1580, 124],
  [140, 46], [180, 62], [660, 40],
];
