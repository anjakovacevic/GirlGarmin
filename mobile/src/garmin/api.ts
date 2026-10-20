/** Garmin Connect API calls the app uses - the same endpoints as the garminconnect Python library. */

import {
  CONNECTAPI, expiresSoon, fetchWithTimeout, GarminAuthError, GarminRateLimitError, nativeHeaders, refreshTokens, saveTokens,
  type Tokens,
} from './auth';

export class GarminNotFoundError extends Error {}

type Params = Record<string, string | number | boolean>;

const query = (p?: Params) =>
  p ? '?' + Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';

export class Garmin {
  displayName = '';
  fullName = '';

  constructor(private tokens: Tokens) {}

  private async refresh(): Promise<void> {
    this.tokens = await refreshTokens(this.tokens);
    await saveTokens(this.tokens);
  }

  async request(method: string, path: string, o: { params?: Params; json?: unknown } = {}): Promise<any> {
    if (expiresSoon(this.tokens.di_token)) await this.refresh();
    const send = () =>
      fetchWithTimeout(CONNECTAPI + path + query(o.params), {
        method,
        headers: nativeHeaders({
          Authorization: `Bearer ${this.tokens.di_token}`,
          Accept: 'application/json',
          ...(o.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        }),
        body: o.json !== undefined ? JSON.stringify(o.json) : undefined,
      }, 60_000);
    let r = await send();
    if (r.status === 401) {
      await this.refresh();
      r = await send();
    }
    if (r.status === 204) return {};
    if (r.status === 404) throw new GarminNotFoundError(`Not found: ${path}`);
    if (r.status === 429) throw new GarminRateLimitError('Rate limited by Garmin');
    if (r.status === 401 || r.status === 403) {
      throw new GarminAuthError(`Garmin refused the request (HTTP ${r.status}). Try logging out and signing in again.`);
    }
    if (r.status >= 400) throw new Error(`Garmin API error ${r.status} for ${path}`);
    const text = await r.text();
    return text ? JSON.parse(text) : {};
  }

  get = (path: string, params?: Params) => this.request('GET', path, { params });

  /** Loads the display name that most URLs need, and checks the login works. */
  async loadProfile(): Promise<void> {
    const prof = await this.get('/userprofile-service/socialProfile');
    this.displayName = prof?.displayName || '';
    this.fullName = prof?.fullName || this.displayName;
    if (!this.displayName) throw new GarminAuthError('Garmin returned no profile - sign in again.');
  }

  private get dn() {
    return encodeURIComponent(this.displayName);
  }

  // ---------------------------------------------------------------- profile
  getUserProfile = () => this.get('/userprofile-service/userprofile/user-settings');
  getUserprofileSettings = () => this.get('/userprofile-service/userprofile/settings');
  getPersonalRecord = () => this.get(`/personalrecord-service/personalrecord/prs/${this.dn}`);
  getDevices = () => this.get('/device-service/deviceregistration/devices');
  getHeartRateZones = () => this.get('/biometric-service/heartRateZones');
  getBodyComposition = (start: string, end: string) =>
    this.get('/weight-service/weight/dateRange', { startDate: start, endDate: end });
  getWeighIns = (start: string, end: string) =>
    this.get(`/weight-service/weight/range/${start}/${end}`, { includeAll: true });

  // ---------------------------------------------------------------- activities
  /** All activities between two dates, 20 per request like Garmin's website. */
  async getActivitiesByDate(start: string, end: string): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; i < 1000; i++) {
      const page = await this.get('/activitylist-service/activities/search/activities', {
        startDate: start, endDate: end, start: out.length, limit: 20,
      });
      if (!Array.isArray(page) || !page.length) return out;
      out.push(...page);
    }
    throw new Error('Too many activity pages');
  }

  getActivityExerciseSets = (id: number | string) => this.get(`/activity-service/activity/${id}/exerciseSets`);

  // ---------------------------------------------------------------- daily health
  getStats = (day: string) => this.get(`/usersummary-service/usersummary/daily/${this.dn}`, { calendarDate: day });
  getSleepData = (day: string) =>
    this.get(`/wellness-service/wellness/dailySleepData/${this.dn}`, { date: day, nonSleepBufferMinutes: 60 });
  getHrvData = (day: string) => this.get(`/hrv-service/hrv/${day}`);
  getTrainingReadiness = (day: string) => this.get(`/metrics-service/metrics/trainingreadiness/${day}`);

  // ---------------------------------------------------------------- cycle
  getMenstrualCalendarData = (start: string, end: string) =>
    this.get(`/periodichealth-service/menstrualcycle/calendar/${start}/${end}`);
  getMenstrualCycleSummary = (day: string) => this.get(`/periodichealth-service/menstrualcycle/summary/${day}`);

  // ---------------------------------------------------------------- workouts
  uploadWorkout = (w: unknown) => this.request('POST', '/workout-service/workout', { json: w });
  scheduleWorkout = (id: number, day: string) =>
    this.request('POST', `/workout-service/schedule/${id}`, { json: { date: day } });
  deleteWorkout = (id: number) => this.request('DELETE', `/workout-service/workout/${id}`);
  /** Take one entry off the calendar; the workout itself stays (it may be on other days too). */
  unscheduleWorkout = (scheduleId: number) => this.request('DELETE', `/workout-service/schedule/${scheduleId}`);
}
