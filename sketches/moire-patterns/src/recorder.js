import { reactive } from 'vue'

// Shared recording state so the control panel can show live status while
// MoireCanvas owns the MediaRecorder.
export const recState = reactive({
  active: false,
  seconds: 0,
})
