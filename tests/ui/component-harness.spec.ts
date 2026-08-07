import { mount } from '@vue/test-utils'
import { expect, test } from 'vitest'

import ComponentHarness from './ComponentHarness.vue'

test('mounts a Vue SFC in the configured happy-dom environment', () => {
  const wrapper = mount(ComponentHarness)

  expect(wrapper.get('[aria-label="Component test harness"]').text()).toBe(
    'Vue component testing ready'
  )
  expect('happyDOM' in window).toBe(true)
})
