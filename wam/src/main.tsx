import ReactDOM from 'react-dom/client'
import * as ChannelService from '@channel.io/channel-web-sdk-loader'

import App from './App.tsx'
import './index.css'

const channelPluginKey = import.meta.env.VITE_CHANNEL_PLUGIN_KEY?.trim()

if (channelPluginKey) {
  ChannelService.loadScript()
  ChannelService.boot({
    pluginKey: channelPluginKey,
    language: 'ko',
    // Keep the SDK button above the fixed tab bar on mobile.
    zIndex: 10000000,
    channelButtonOption: {
      position: 'right',
      xMargin: 16,
      yMargin: 88,
    },
  } as Parameters<typeof ChannelService.boot>[0])
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
