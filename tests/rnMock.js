/**
 * react-native mock for jest (node environment).
 *
 * The original exports (I18nManager, Platform) are unchanged. The host
 * components below exist so UI render-smoke tests can mount screens
 * with react-dom/server: they render plain DOM elements and resolve
 * RN's function-valued children the way RN would.
 */
const React = require('react');

function host(tag) {
  return function MockHostComponent(props) {
    const { children } = props || {};
    const content = typeof children === 'function' ? children({ pressed: false }) : children;
    return React.createElement(tag, { 'data-rn': tag }, content);
  };
}

const View = host('div');
const Text = host('span');
const ScrollView = host('div');
const Pressable = host('button');
const Switch = host('button');
const Image = host('img');
const ActivityIndicator = host('div');
const TextInput = function MockTextInput(props) {
  return React.createElement('input', { value: (props && props.value) || '', readOnly: true });
};

module.exports = {
  I18nManager: { allowRTL: () => undefined, forceRTL: () => undefined, isRTL: false },
  Platform: { OS: 'android' },
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Image,
  ActivityIndicator,
  TextInput,
  StyleSheet: {
    create: (styles) => styles,
    flatten: (s) => s,
    hairlineWidth: 1,
    absoluteFillObject: {},
  },
  Alert: { alert: () => undefined },
  Linking: { openSettings: async () => undefined, openURL: async () => undefined },
  useColorScheme: () => 'light',
  Dimensions: {
    get: () => ({ width: 390, height: 844 }),
    addEventListener: () => ({ remove: () => undefined }),
  },
  PixelRatio: { get: () => 2, roundToNearestPixel: (v) => v },
  requireNativeComponent: () => host('div'),
  UIManager: { getViewManagerConfig: () => null },
  NativeModules: {},
  Animated: {
    View,
    Text,
    Value: class {
      constructor(v) {
        this._v = v;
      }
      setValue(v) {
        this._v = v;
      }
    },
    timing: () => ({ start: (cb) => cb && cb() }),
    createAnimatedComponent: (c) => c,
  },
  Easing: { ease: (t) => t },
};
