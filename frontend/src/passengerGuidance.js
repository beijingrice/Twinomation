export const LONG_DELAY_MINUTES = 120;

// Compare departure with the original schedule, not with how long remains now.
export function guidanceMode(status) {
  if (status.status !== 'DELAYED') return 'none';
  if (!status.departure) return 'pending';
  const minutes = (Date.parse(status.departure) - Date.parse(status.scheduled)) / 60000;
  return !Number.isFinite(minutes) ? 'pending' : minutes >= LONG_DELAY_MINUTES ? 'long' : 'short';
}

/** Read-only feasibility, not inventory or rebooking. Recomputed with the clock. */
export function connectionRows(connection, status, now) {
  const arrival = status.departure
    ? new Date(Date.parse(status.departure) + status.block_minutes * 60000) : null;
  return {
    arrival,
    rows: connection.flights.map(f => {
      const departure = f.estimated_departure || f.departure;
      const departed = f.status === 'DEPARTED' || Date.parse(departure) <= +now;
      const cancelled = f.status === 'CANCELLED';
      const transferMinutes = arrival && departure ? (Date.parse(departure) - Math.max(+arrival,+now)) / 60000 : null;
      const state = cancelled ? 'cancelled' : departed ? 'departed' : transferMinutes == null ? 'unknown'
        : transferMinutes <= 30 ? 'tight' : transferMinutes < 60 ? 'limited' : 'possible';
      const unavailable = cancelled || departed || transferMinutes != null && transferMinutes < connection.min_connection_minutes;
      return {...f, departure, state, transferMinutes, unavailable, booked: f.flight_no === connection.booked};
    })
  };
}
