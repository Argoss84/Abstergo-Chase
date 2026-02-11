/**
 * Types pour le hand tracking MediaPipe (HandTracking2D).
 * @see https://blog.tensorflow.org/2021/11/3D-handpose.html
 */

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
