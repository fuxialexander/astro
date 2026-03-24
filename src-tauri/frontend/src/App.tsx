import { BrowserRouter, Routes, Route } from 'react-router'
import { ProjectList } from '@desktop/pages/ProjectList'
import { Workspace } from '@desktop/pages/Workspace'

export function App() {
  return (
    <BrowserRouter>
      <div className="h-screen w-screen bg-background text-foreground font-primary">
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/project/:id" element={<Workspace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
