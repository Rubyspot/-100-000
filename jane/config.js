// Where Jane's live brain and voice come from.
//
// AGENT_ID is the ElevenLabs Agents id created by tools/jane/create-agent.mjs.
// It is public by design (the page is static and talks to ElevenLabs straight
// from the headset), so it is safe to commit; the API key never is.
// ?agent=<id> overrides it for testing; ?jane=scripted forces the offline
// scripted Jane; ?jane=off hides her.
const params = new URLSearchParams(location.search);

export const AGENT_ID = params.get('agent') || '';
export const MODE = params.get('jane') || (AGENT_ID ? 'live' : 'scripted');

// Jane stands this far in front of the player's arrival point, a little to
// the side so the coffee table and the play ball stay in view.
export const STAND_DISTANCE = 1.25; // m
export const STAND_OFFSET = 0.35;   // m to the player's left
