package com.nicodev.filmscanner;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.nicodev.filmscanner.plugins.NativeARPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins
        registerPlugin(NativeARPlugin.class);
        
        super.onCreate(savedInstanceState);
    }
}
