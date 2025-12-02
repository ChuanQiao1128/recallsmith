// mobile/index.ts
import { registerRootComponent } from 'expo';
import App from './App';

// 这一行会内部调用 AppRegistry.registerComponent('main', () => App)
registerRootComponent(App);