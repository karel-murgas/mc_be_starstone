// Player-facing prose lives in RP language files; arguments follow RawMessage.
export function message(key, ...values) {
    return { translate: `starstone.message.${key}`, with: values.map(value => String(value)) };
}
