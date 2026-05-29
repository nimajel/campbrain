// Re-export from the framework-agnostic src/ui module so Next.js and tests can both import
export {
  emptyForm,
  alertToForm,
  formToPayload,
  validateForm,
  bookingRuleDescription,
  applyParkToForm,
  applyCampgroundToForm,
} from '../../src/ui/alert-form';

export type { FormState, ValidationError } from '../../src/ui/alert-form';
