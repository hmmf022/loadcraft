import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { createVoxelGrid } from './core/voxelGridSingleton'
import { useAppStore } from './state/store'
import './ui/styles/global.css'

// Initialize VoxelGrid before React render
const container = useAppStore.getState().container
createVoxelGrid(container)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
