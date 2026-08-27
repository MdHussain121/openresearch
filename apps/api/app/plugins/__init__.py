"""Built-in OpenResearch plugins (Roadmap 9.4).

Each module exposes hook callables with the signature
``hook(payload: dict, config: dict | None) -> dict`` referenced
by ``PluginConfig.entrypoints`` in ``module:function`` form.
"""
