import { BrowserRouter } from 'react-router-dom';
import { Providers } from './app/providers.js';
import { AppRoutes } from './routes/AppRoutes.js';

export default function App() {
  return (
    <Providers>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  );
}
