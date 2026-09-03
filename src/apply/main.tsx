// Public application form entry — a SEPARATE Vite page from the internal
// app: no session, no Supabase client, no internal code. It talks only to
// the hiring-intake edge function (the single public path into hiring).

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApplyForm } from './ApplyForm'
import '../index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApplyForm />
  </StrictMode>,
)
