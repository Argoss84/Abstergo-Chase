/**
 * Types pour le hand tracking MediaPipe / TensorFlow.js
 * @see https://blog.tensorflow.org/2021/11/3D-handpose.html
 */

/** Noms des 21 keypoints MediaPipe Hands */
export const MEDIAPIPE_KEYPOINT_NAMES = [
  'wrist',
  'thumb_cmc',
  'thumb_mcp',
  'thumb_ip',
  'thumb_tip',
  'index_finger_mcp',
  'index_finger_pip',
  'index_finger_dip',
  'index_finger_tip',
  'middle_finger_mcp',
  'middle_finger_pip',
  'middle_finger_dip',
  'middle_finger_tip',
  'ring_finger_mcp',
  'ring_finger_pip',
  'ring_finger_dip',
  'ring_finger_tip',
  'pinky_finger_mcp',
  'pinky_finger_pip',
  'pinky_finger_dip',
  'pinky_finger_tip',
] as const;

export type MediaPipeKeypointName = (typeof MEDIAPIPE_KEYPOINT_NAMES)[number];

export interface HandJoint {
  position: { x: number; y: number; z: number };
  radius: number;
}

export interface HandData {
  joints: Map<string, HandJoint>;
  handedness: 'left' | 'right';
  /** Position du groupe main dans l’espace caméra (devant l’utilisateur en AR) */
  groupPosition: { x: number; y: number; z: number };
}

/** Connexions osseuses pour MediaPipe Hands (index du schéma) */
export const MEDIAPIPE_BONE_CONNECTIONS: Array<[string, string]> = [
  ['wrist', 'thumb_cmc'],
  ['thumb_cmc', 'thumb_mcp'],
  ['thumb_mcp', 'thumb_ip'],
  ['thumb_ip', 'thumb_tip'],
  ['wrist', 'index_finger_mcp'],
  ['index_finger_mcp', 'index_finger_pip'],
  ['index_finger_pip', 'index_finger_dip'],
  ['index_finger_dip', 'index_finger_tip'],
  ['wrist', 'middle_finger_mcp'],
  ['middle_finger_mcp', 'middle_finger_pip'],
  ['middle_finger_pip', 'middle_finger_dip'],
  ['middle_finger_dip', 'middle_finger_tip'],
  ['wrist', 'ring_finger_mcp'],
  ['ring_finger_mcp', 'ring_finger_pip'],
  ['ring_finger_pip', 'ring_finger_dip'],
  ['ring_finger_dip', 'ring_finger_tip'],
  ['wrist', 'pinky_finger_mcp'],
  ['pinky_finger_mcp', 'pinky_finger_pip'],
  ['pinky_finger_pip', 'pinky_finger_dip'],
  ['pinky_finger_dip', 'pinky_finger_tip'],
];
