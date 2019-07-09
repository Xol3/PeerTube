import { Injectable } from '@angular/core'
import { Router } from '@angular/router'
import { ServerConfigPlugin } from '@shared/models'
import { ServerService } from '@app/core/server/server.service'
import { ClientScript } from '@shared/models/plugins/plugin-package-json.model'
import { PluginScope } from '@shared/models/plugins/plugin-scope.type'
import { environment } from '../../../environments/environment'
import { RegisterHookOptions } from '@shared/models/plugins/register.model'
import { ReplaySubject } from 'rxjs'
import { first } from 'rxjs/operators'

interface HookStructValue extends RegisterHookOptions {
  plugin: ServerConfigPlugin
  clientScript: ClientScript
}

@Injectable()
export class PluginService {
  pluginsLoaded = new ReplaySubject<boolean>(1)

  private plugins: ServerConfigPlugin[] = []
  private scopes: { [ scopeName: string ]: { plugin: ServerConfigPlugin, clientScript: ClientScript }[] } = {}
  private loadedScripts: { [ script: string ]: boolean } = {}

  private hooks: { [ name: string ]: HookStructValue[] } = {}

  constructor (
    private router: Router,
    private server: ServerService
  ) {
  }

  initializePlugins () {
    this.server.configLoaded
      .subscribe(() => {
        this.plugins = this.server.getConfig().plugin.registered

        this.buildScopeStruct()

        this.pluginsLoaded.next(true)
      })
  }

  ensurePluginsAreLoaded () {
    return this.pluginsLoaded.asObservable()
               .pipe(first())
               .toPromise()
  }

  async loadPluginsByScope (scope: PluginScope) {
    try {
      await this.ensurePluginsAreLoaded()

      const toLoad = this.scopes[ scope ]
      if (!Array.isArray(toLoad)) return

      const promises: Promise<any>[] = []
      for (const { plugin, clientScript } of toLoad) {
        if (this.loadedScripts[ clientScript.script ]) continue

        promises.push(this.loadPlugin(plugin, clientScript))

        this.loadedScripts[ clientScript.script ] = true
      }

      return Promise.all(promises)
    } catch (err) {
      console.error('Cannot load plugins by scope %s.', scope, err)
    }
  }

  async runHook (hookName: string, param?: any) {
    let result = param

    const wait = hookName.startsWith('static:')

    for (const hook of this.hooks[hookName]) {
      try {
        if (wait) result = await hook.handler(param)
        else result = hook.handler()
      } catch (err) {
        console.error('Cannot run hook %s of script %s of plugin %s.', hookName, hook.plugin, hook.clientScript, err)
      }
    }

    return result
  }

  private loadPlugin (plugin: ServerConfigPlugin, clientScript: ClientScript) {
    const registerHook = (options: RegisterHookOptions) => {
      if (!this.hooks[options.target]) this.hooks[options.target] = []

      this.hooks[options.target].push({
        plugin,
        clientScript,
        target: options.target,
        handler: options.handler,
        priority: options.priority || 0
      })
    }

    console.log('Loading script %s of plugin %s.', clientScript.script, plugin.name)

    const url = environment.apiUrl + `/plugins/${plugin.name}/${plugin.version}/client-scripts/${clientScript.script}`

    return import(/* webpackIgnore: true */ url)
      .then(script => script.register({ registerHook }))
      .then(() => this.sortHooksByPriority())
  }

  private buildScopeStruct () {
    for (const plugin of this.plugins) {
      for (const key of Object.keys(plugin.clientScripts)) {
        const clientScript = plugin.clientScripts[key]

        for (const scope of clientScript.scopes) {
          if (!this.scopes[scope]) this.scopes[scope] = []

          this.scopes[scope].push({
            plugin,
            clientScript
          })

          this.loadedScripts[clientScript.script] = false
        }
      }
    }
  }

  private sortHooksByPriority () {
    for (const hookName of Object.keys(this.hooks)) {
      this.hooks[hookName].sort((a, b) => {
        return b.priority - a.priority
      })
    }
  }
}
