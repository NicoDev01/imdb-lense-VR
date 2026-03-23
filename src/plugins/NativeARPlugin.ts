import { registerPlugin } from '@capacitor/core';
import type { NativeARPluginInterface } from './NativeARTypes';

// Re-export types for convenience
export type { 
  TrackedObject, 
  DetectionUpdateEvent, 
  ZoomInfo, 
  CropResult, 
  NativeARPluginInterface 
} from './NativeARTypes';

// Register the plugin
const NativeAR = registerPlugin<NativeARPluginInterface>('NativeAR', {
  web: () => import('./NativeARPluginWeb').then(m => new m.NativeARPluginWeb()),
});

export default NativeAR;
