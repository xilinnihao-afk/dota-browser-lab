import {installBrowserGestureGuard} from './browser-gestures';
import './browser-gestures.css';
const disposeGestureGuard=installBrowserGestureGuard(document);
if(import.meta.hot)import.meta.hot.dispose(disposeGestureGuard);

// The rejected procedural prototype remains available for its reusable simulation.
if (new URLSearchParams(location.search).has('prototype')) {
  void import('./prototype');
} else if (new URLSearchParams(location.search).has('models')) {
  void import('./classic/main');
} else {
  const loading=mapLoading();loading.set(1,'正在准备地图');
  void import('./classic/map-main').catch(error=>{loading.fail(error);console.error(error);});
}
import {mapLoading} from './classic/loading-screen';
