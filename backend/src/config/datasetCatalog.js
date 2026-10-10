/**
 * Public datasets the admin console knows how to use. Kaggle entries download with one click
 * (kagglehub, no account needed for public datasets); video datasets need a request/registration on
 * their own site, so the admin downloads them manually into VIDEO_DATASETS_DIR and runs "Process".
 *
 * task:
 *   eye_state         open/closed eye crops   → trains the eye-state image model
 *   yawn_calibration  yawn / no-yawn faces    → calibrates the yawn detector's mouth threshold
 *   video             labelled driving videos → recordings for the false-alarm verifier
 *   reference         listed for completeness; too large or not usable automatically
 */
const CATALOG = [
  {
    id: 'yawn-eye',
    title: 'Yawn & Eye Dataset (new)',
    source: 'kaggle',
    slug: 'serenaraju/yawn-eye-dataset-new',
    sizeMb: 176,
    task: 'eye_state',
    classes: { open: 'Open', closed: 'Closed' },
    description:
      'Close-up photos of open and closed eyes (≈1,450 used). The current eye model was trained on it.',
  },
  {
    id: 'drowsiness-eyes',
    title: 'Drowsiness Dataset',
    source: 'kaggle',
    slug: 'dheerajperumandla/drowsiness-dataset',
    sizeMb: 176,
    task: 'eye_state',
    classes: { open: 'Open', closed: 'Closed' },
    description:
      'Open/closed eye photos plus yawn faces, from a different collection: more variety.',
  },
  {
    id: 'mrl-eyes',
    title: 'MRL Eye (Drowsiness Detection Dataset)',
    source: 'kaggle',
    slug: 'prasadvpatil/mrl-dataset',
    sizeMb: 23,
    task: 'eye_state',
    classes: { open: 'Open_Eyes', closed: 'Closed_Eyes' },
    perClass: 2000,
    description: 'Infrared eye crops from the MRL Eye dataset: helps night-time / IR cameras.',
  },
  {
    id: 'yawn-faces',
    title: 'Yawn & Eye Dataset: yawn faces',
    source: 'kaggle',
    slug: 'serenaraju/yawn-eye-dataset-new',
    sizeMb: 176,
    task: 'yawn_calibration',
    classes: { yawn: 'yawn', noYawn: 'no_yawn' },
    description:
      'Full-face photos of drivers yawning vs. not: tunes the mouth-opening threshold of the yawn detector.',
  },
  {
    id: 'yawn',
    title: 'Yawn Dataset (mouth crops)',
    source: 'kaggle',
    slug: 'davidvazquezcic/yawn-dataset',
    sizeMb: 18,
    task: 'reference',
    description:
      'Small crops of the mouth only (≈70 px). Good for a mouth image classifier, but the face-landmark yawn ' +
      'detector needs whole faces, so it is not used for calibration.',
  },
  {
    id: 'ddd',
    title: 'Driver Drowsiness Dataset (DDD)',
    source: 'kaggle',
    slug: 'ismailnasri20/driver-drowsiness-dataset-ddd',
    sizeMb: 2762,
    task: 'reference',
    description:
      'Face frames labelled drowsy / non-drowsy, extracted from UTA-RLDD. 2.7 GB; single frames carry no ' +
      'timing, so use the original RLDD videos (below) for the verifier.',
  },
  {
    id: 'uta-rldd',
    title: 'UTA Real-Life Drowsiness Dataset (UTA-RLDD)',
    source: 'manual',
    url: 'https://sites.google.com/view/utarldd/home',
    task: 'video',
    preset: 'rldd',
    description:
      '60 participants, ~30 hours of webcam video: alert (0), low vigilance (5) and drowsy (10). Request access, ' +
      'then place it as <VIDEO_DATASETS_DIR>/uta-rldd/<participant>/<0|5|10>.mov.',
  },
  {
    id: 'nthu-ddd',
    title: 'NTHU Driver Drowsiness Detection Dataset',
    source: 'manual',
    url: 'https://cv.cs.nthu.edu.tw/php/callforpaper/datasets/DDD/',
    task: 'video',
    preset: 'folders',
    description:
      'Simulated driving with glasses / night-IR variants. Request access, then sort videos into sub-folders ' +
      'named "drowsy" and "alert" under <VIDEO_DATASETS_DIR>/nthu-ddd/.',
  },
  {
    id: 'yawdd',
    title: 'YawDD: Yawning Detection Dataset',
    source: 'manual',
    url: 'https://ieee-dataport.org/open-access/yawdd-yawning-detection-dataset',
    task: 'video',
    preset: 'folders',
    description:
      'Drivers talking, singing and yawning in cars. Sort into "alert" (normal/talking) and "drowsy" (yawning) ' +
      'sub-folders under <VIDEO_DATASETS_DIR>/yawdd/.',
  },
];

function findDataset(id) {
  return CATALOG.find((d) => d.id === id) || null;
}

module.exports = { CATALOG, findDataset };
