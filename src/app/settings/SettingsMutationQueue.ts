/**
 * Serializes settings read-modify-save transactions for one live settings
 * object. A queued mutation never observes another mutation's unpersisted
 * candidate, so a failed save can safely restore its own previous state.
 */
const settingsMutationCompletions = new WeakMap<object, Promise<void>>();

export function runSerializedSettingsMutation<T>(
  settings: object,
  mutation: () => Promise<T>,
): Promise<T> {
  const predecessor = settingsMutationCompletions.get(settings);
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  settingsMutationCompletions.set(settings, completion);

  const finish = (): void => {
    release();
    if (settingsMutationCompletions.get(settings) === completion) {
      settingsMutationCompletions.delete(settings);
    }
  };

  const run = (): Promise<T> => {
    let result: Promise<T>;
    try {
      result = mutation();
    } catch (error) {
      finish();
      return Promise.reject(error);
    }
    void result.then(finish, finish);
    return result;
  };

  return predecessor ? predecessor.then(run) : run();
}
