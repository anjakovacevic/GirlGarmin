/** Sign in on Garmin's own sign-in page (the one the Garmin Connect Android app uses), shown in
 * the app. Your password goes straight to Garmin; when Garmin hands back a one-time ticket, the
 * app swaps it for login tokens (garmin/auth.ts). */

import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { Garmin } from '../garmin/api';
import { exchangeTicket, LOGIN_URL, MOBILE_SERVICE_URL, parseTokenFile, saveTokens, ticketFrom, type Tokens } from '../garmin/auth';
import { Button, Caption, Expander, Notice, Rich } from './components';
import { KeyIcon, LockIcon, PhoneIcon } from './icons';
import { useTheme } from './theme';

/** Runs inside Garmin's sign-in page. After the password or the two-step code, the page gets the
 * ticket in a JSON reply ("serviceTicketId") and doesn't always redirect afterwards, so the app
 * would never see it in a URL. This passes every ticket the page receives on to the app. */
const CATCH_TICKET = `(function () {
  if (window.__ggTicket) return;
  window.__ggTicket = true;
  function scan(text) {
    try {
      if (typeof text !== 'string') return;
      var m = /"serviceTicketId"\\s*:\\s*"(ST-[^"]+)"/.exec(text) || /[?&]ticket=(ST-[^&"'\\s<]+)/.exec(text);
      if (m) window.ReactNativeWebView.postMessage(JSON.stringify({ ticket: m[1] }));
    } catch (e) {}
  }
  var f = window.fetch;
  if (f) window.fetch = function () {
    return f.apply(this, arguments).then(function (r) {
      try { r.clone().text().then(scan, function () {}); } catch (e) {}
      return r;
    });
  };
  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try { scan(this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText); } catch (e) {}
    });
    return send.apply(this, arguments);
  };
  document.addEventListener('DOMContentLoaded', function () { scan(document.documentElement.innerHTML); });
})(); true;`;

const POINTS = [
  { Icon: LockIcon, text: "You sign in on **Garmin's own page**. GirlGarmin never sees your password." },
  { Icon: KeyIcon, text: "Only a login token is kept, in your phone's secure storage." },
  { Icon: PhoneIcon, text: 'Your data stays **in this app on this phone**. No accounts, no cloud, no tracking.' },
];

export function LoginScreen({ onLoggedIn, onCancel }: { onLoggedIn: (t: Tokens) => void; onCancel?: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [web, setWeb] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const handled = useRef(false);

  async function finish(get: () => Promise<Tokens>) {
    setStage('Confirming your sign-in with Garmin');
    setError(null);
    try {
      const tokens = await get();
      setStage('Loading your Garmin profile');
      const api = new Garmin(tokens);
      await api.loadProfile(); // checks the tokens work
      await saveTokens(tokens);
      onLoggedIn(tokens);
    } catch (e) {
      setError((e as Error).message);
      handled.current = false;
    } finally {
      setStage(null);
    }
  }

  function takeTicket(ticket: string) {
    if (handled.current) return;
    handled.current = true;
    setWeb(false);
    finish(() => exchangeTicket(ticket));
  }

  /** Stop at Garmin's redirect back to the app and take the ticket from it. */
  function intercept(url: string): boolean {
    const ticket = ticketFrom(url);
    if (ticket) {
      takeTicket(ticket);
      return false;
    }
    // the Garmin Connect app's own links (intent://, gcm://...) can't open here
    return /^https?:/.test(url) && !url.startsWith(MOBILE_SERVICE_URL);
  }

  function onMessage(e: WebViewMessageEvent) {
    try {
      const ticket = JSON.parse(e.nativeEvent.data)?.ticket;
      if (typeof ticket === 'string' && ticket.startsWith('ST-')) takeTicket(ticket);
    } catch {
      // not ours
    }
  }

  const start = () => {
    handled.current = false;
    setError(null);
    setWeb(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={[st.wrap, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 14 }}>
          <Text style={[st.brand, { color: t.accent }]}>GirlGarmin</Text>
          <Text style={[st.headline, { color: t.text }]}>Your training, sleep and cycle, side by side.</Text>
          <Text style={[st.lead, { color: t.muted }]}>Connect your Garmin account to download your data to this phone.</Text>
        </View>

        <View style={[st.card, { backgroundColor: t.card }]}>
          {POINTS.map(({ Icon, text }, i) => (
            <View key={i} style={st.point}>
              <View style={[st.pointIcon, { backgroundColor: t.accentSoft }]}>
                <Icon color={t.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Rich text={text} />
              </View>
            </View>
          ))}
        </View>

        <View style={{ flexGrow: 1 }} />

        <View style={{ gap: 10 }}>
          {stage ? (
            <View style={[st.status, { backgroundColor: t.card }]}>
              <ActivityIndicator color={t.accent} />
              <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>{stage}…</Text>
            </View>
          ) : (
            <>
              {error ? <Notice tone="error" text={`**Sign-in didn't finish.** ${error}`} /> : null}
              <Button title={error ? 'Try again' : 'Sign in with Garmin'} onPress={start} />
              {onCancel ? <Button kind="secondary" title="Not now" onPress={onCancel} /> : null}
            </>
          )}
        </View>

        <View style={[st.card, { backgroundColor: t.card, paddingVertical: 4 }]}>
          <Expander title="Use the login from your computer">
            <Caption>
              If signing in here doesn't work, open .garminconnect/garmin_tokens.json in your user folder on the computer where the
              GirlGarmin website is logged in, and paste all of its text below. The phone and the computer then share one login.
            </Caption>
            <TextInput
              value={pasted}
              onChangeText={setPasted}
              multiline
              placeholder='{"di_token": "...", ...}'
              placeholderTextColor={t.muted}
              style={[st.paste, { backgroundColor: t.surface, color: t.text }]}
            />
            <Button kind="secondary" title="Use these tokens" disabled={!pasted.trim() || !!stage} onPress={() => finish(async () => parseTokenFile(pasted))} />
          </Expander>
        </View>

        <Text style={[st.fine, { color: t.muted }]}>Not medical advice, and not suitable for contraception. Cycle predictions are estimates.</Text>
      </ScrollView>

      <Modal visible={web} animationType="slide" onRequestClose={() => setWeb(false)}>
        <View style={{ flex: 1, backgroundColor: t.card, paddingTop: insets.top }}>
          <View style={[st.bar, { borderBottomColor: t.border }]}>
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>Garmin sign-in</Text>
            <Pressable onPress={() => setWeb(false)} hitSlop={12}>
              <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          </View>
          <WebView
            source={{ uri: LOGIN_URL }}
            incognito
            forceDarkOn={false}
            setSupportMultipleWindows={false}
            injectedJavaScriptBeforeContentLoaded={CATCH_TICKET}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={(r) => intercept(r.url)}
            onNavigationStateChange={(n: WebViewNavigation): void => { intercept(n.url); }}
            startInLoadingState
            renderLoading={() => <ActivityIndicator style={StyleSheet.absoluteFill} color={t.accent} />}
          />
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexGrow: 1, paddingHorizontal: 20, gap: 20 },
  brand: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  headline: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.9 },
  lead: { fontSize: 16, lineHeight: 23 },
  card: { borderRadius: 20, paddingHorizontal: 18, paddingVertical: 16, gap: 16 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  pointIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 20 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  paste: { borderRadius: 12, padding: 12, minHeight: 90, fontSize: 12, textAlignVertical: 'top' },
  fine: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
