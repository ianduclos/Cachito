import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { gameLogPersistencePlugin } from './dev/gameLogPersistence'
import { installOnlineRooms } from './dev/onlineRooms'

export default defineConfig({
  plugins: [react(), gameLogPersistencePlugin(), {
    name: 'cachito-online-rooms',
    configureServer(server) {
      if (server.httpServer) installOnlineRooms(server.httpServer as import('node:http').Server)
    },
  }],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
