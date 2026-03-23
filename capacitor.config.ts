import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nicodev.filmscanner',
  appName: 'Film Scanner',
  webDir: 'dist',
  plugins: {
    Camera: {
      quality: 90,
      resultType: 'base64',
      source: 'camera',
      direction: 'rear',
      saveToGallery: false,
      correctOrientation: true
    }
  }
};

export default config;
