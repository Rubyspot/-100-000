// Herring gull colours by body part, as the body of a function(x, y, z, mat, bone, nx, ny, nz)
// returning [r, g, b]. Bind pose in centimetres: x = wingspan, -y = forward, z = up.
// mat: 0 body, 1 eyes, 2 feather cards. bone: the vertex's main bone without "Seagull_"/"_bone".
const WHITE = [0.95, 0.95, 0.94], GREY = [0.58, 0.63, 0.68], UNDER = [0.86, 0.88, 0.9];
const BLACK = [0.07, 0.07, 0.08], BEAK = [0.96, 0.76, 0.18], SPOT = [0.85, 0.18, 0.08];
const LEG = [0.93, 0.65, 0.58], EYE = [0.05, 0.04, 0.035];
const ax = Math.abs(x);
if (mat === 1) return EYE;
if (bone === 'Beak' || bone === 'Bone020' || (bone === 'Mandible' && y < -18.3)) {
  if (bone === 'Mandible' && y < -22 && z < 42.6) return SPOT;
  return BEAK;
}
if (/Ankle|Toe|Digit/.test(bone) || (bone.includes('Knee') && z < 11)) return LEG;
const wing = /Clav|Humerus|Ulna|Aula|PF|SF/.test(bone);
if (wing) {
  if (ax > 84) return WHITE;            // white "mirror" at the very tip
  if (ax > 43) return BLACK;            // black wingtips
  if (/SF/.test(bone) && y > 7) return WHITE; // white trailing edge
  if (mat === 2) return GREY;
  return nz > -0.15 ? GREY : UNDER;
}
if (/TF/.test(bone) || bone === 'Tail') return WHITE;
// Grey mantle on the back between the wings, white everywhere else.
if (/Spine|Pelvis/.test(bone) && nz > 0.35 && z > 25 && y < 6) return GREY;
return WHITE;
