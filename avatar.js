function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function hslFromHash(h, idx) {
  const hue = ((h >> (idx * 5)) & 0x1FF) % 360;
  const sat = 55 + ((h >> (idx * 3 + 2)) & 0x1F);
  const lit = 45 + ((h >> (idx * 2 + 7)) & 0x1F);
  return "hsl(" + hue + "," + sat + "%," + lit + "%)";
}

function generateAvatarSVG(seed, size) {
  const h = hashSeed(seed || "default");
  const bg = hslFromHash(h, 0);
  const fg1 = hslFromHash(h, 1);
  const fg2 = hslFromHash(h, 2);
  const fg3 = hslFromHash(h, 3);
  const s = size || 42;
  const shapes = [];
  const cx = s / 2, cy = s / 2, r = s * 0.38;
  shapes.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fg1 + '"/>');
  const eyeY = cy - r * 0.15, eyeR = r * 0.14;
  const eyeL = cx - r * 0.32, eyeRx = cx + r * 0.32;
  shapes.push('<circle cx="' + eyeL + '" cy="' + eyeY + '" r="' + eyeR + '" fill="' + bg + '"/>');
  shapes.push('<circle cx="' + eyeRx + '" cy="' + eyeY + '" r="' + eyeR + '" fill="' + bg + '"/>');
  const mouthW = r * 0.5, mouthY = cy + r * 0.25;
  if ((h & 0x3) === 0) shapes.push('<line x1="' + (cx - mouthW) + '" y1="' + mouthY + '" x2="' + (cx + mouthW) + '" y2="' + mouthY + '" stroke="' + bg + '" stroke-width="2" stroke-linecap="round"/>');
  else shapes.push('<path d="M' + (cx - mouthW) + ' ' + mouthY + ' Q ' + cx + ' ' + (mouthY + r * 0.3) + ' ' + (cx + mouthW) + ' ' + mouthY + '" fill="none" stroke="' + bg + '" stroke-width="2" stroke-linecap="round"/>');
  if ((h & 0x4) !== 0) {
    const hatY = cy - r * 0.7, hatH = r * 0.35;
    shapes.push('<rect x="' + (cx - r * 0.5) + '" y="' + hatY + '" width="' + r + '" height="' + hatH + '" rx="3" fill="' + fg2 + '"/>');
  }
  if ((h & 0x8) !== 0) {
    const earR = r * 0.18, earY = cy - r * 0.05;
    shapes.push('<circle cx="' + (cx - r - earR * 0.3) + '" cy="' + earY + '" r="' + earR + '" fill="' + fg3 + '"/>');
    shapes.push('<circle cx="' + (cx + r + earR * 0.3) + '" cy="' + earY + '" r="' + earR + '" fill="' + fg3 + '"/>');
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" width="' + s + '" height="' + s + '"><rect width="' + s + '" height="' + s + '" rx="' + (s * 0.22) + '" fill="' + bg + '"/>' + shapes.join("") + '</svg>';
}

function avatarDataUrl(seed, size) {
  return "data:image/svg+xml," + encodeURIComponent(generateAvatarSVG(seed, size));
}

export { generateAvatarSVG, avatarDataUrl, hashSeed };
