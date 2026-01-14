import { Redirect, Route, Switch } from 'react-router-dom';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Home from './pages/Home';
import NotFound from './pages/NotFound';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* import '@ionic/react/css/palettes/dark.always.css'; */
/* import '@ionic/react/css/palettes/dark.class.css'; */
import '@ionic/react/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';
import CreateLobby from './pages/CreateLobby';
import JoinLobby from './pages/JoinLobby';
import Lobby from './pages/Lobby';
import Agent from './pages/Agent';
import Rogue from './pages/Rogue';
import EndGame from './pages/EndGame';
import SessionDiagnostics from './pages/SessionDiagnostics';
import { WakeLockProvider } from './components/WakeLockProvider';
setupIonicReact();

const App: React.FC = () => {
  return (
    <WakeLockProvider enabled={true}>
      <IonApp>
        <IonReactRouter>
          <IonRouterOutlet>
            <Switch>
              <Route exact path="/" render={() => <Redirect to="/home" />} />
              <Route exact path="/home" render={() => <Home />} />
              <Route exact path="/create-lobby" render={() => <CreateLobby />} />
              <Route exact path="/join-lobby" render={() => <JoinLobby />} />
              <Route exact path="/lobby" render={() => <Lobby />} />
              <Route exact path="/agent" render={() => <Agent />} />
              <Route exact path="/rogue" render={() => <Rogue />} />
              <Route exact path="/end-game" render={() => <EndGame />} />
              <Route exact path="/session-diagnostics" render={() => <SessionDiagnostics />} />
              <Route path="*" component={NotFound} />
            </Switch>
          </IonRouterOutlet>
        </IonReactRouter>
        
        {/* Toast Container global pour toutes les pages */}
        <ToastContainer
          position="top-right"
          autoClose={3000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="light"
        />
      </IonApp>
    </WakeLockProvider>
  );
};

export default App;
