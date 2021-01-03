import * as pulumi from '@pulumi/pulumi'
import * as k8s from '@pulumi/kubernetes'
import * as yaml from 'js-yaml'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
    rules: any[] // TODO
    receivers: any[] // TODO
    routes: any[] // TODO
}

export default class AlertManager extends olly.ComponentResource implements pluggable.ScrapeTarget, pluggable.Notifier {

    readonly metrics: pluggable.ScrapeTargetItem[]
    readonly notificationURLs: pulumi.Output<string>[]

    private readonly args: Args
    private readonly replicas: number

    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Notifier, name, args, opts)
        this.args = args
        this.replicas = 1 // TODO: take exact amount of replicas from the statefulset

        const configmap = this.createConfigMap()
        const ss = this.createStatefulSet(configmap)
        
        this.replicas = 1
        this.notificationURLs = Array.from(Array(this.replicas).keys()).map(num => {
            return pulumi.interpolate `http://${ss.metadata.name}-${num}.${ss.spec.serviceName}:9093`
        })
        this.metrics = []
    }

    private createConfigMap(): k8s.core.v1.ConfigMap {

        const config = this.getDefaultConfig()
        return new k8s.core.v1.ConfigMap(this.name, {
            metadata: {
                name: this.name,
                namespace: this.args.namespace,
                labels: this.labels
            },
            data: {
                'alertmanager.yaml': yaml.safeDump(config),
            }
        }, { parent: this })
    }

    private createStatefulSet(configmap: k8s.core.v1.ConfigMap): k8s.apps.v1.StatefulSet {

        const container: k8s.types.input.core.v1.Container = {
            name: 'alertmanager',
            image: `prom/alertmanager:${this.args.tag}`,
            args: [
                '--config.file=/etc/alertmanager/alertmanager.yaml',
                '--storage.path=/data',
                // '--cluster.listen-address=0.0.0.0:9094',
                // `--cluster.peer=${name}.${cfg.namespace}:9094`,
                // '--web.external-url=WEB.EXTERNAL-URL',
            ],
            ports: [
                { name: 'http', containerPort: 9093 },
                { name: 'cluster', containerPort: 9094 },
            ],
            readinessProbe: {
                httpGet: {
                    port: 'http',
                    path: '/-/ready',
                },
            },
            livenessProbe: {
                httpGet: {
                    port: 'http',
                    path: '/-/healthy',
                },
            },
            volumeMounts: [
                { name: 'storage', mountPath: '/data' },
                {
                    name: 'config',
                    mountPath: '/etc/alertmanager/alertmanager.yaml',
                    subPath: 'alertmanager.yaml',
                    readOnly: true,
                }
            ]
        }

        return this.statefulSetTeamplate(this.name, {
            name: this.name,
            labels: this.labels,
            labelSelector: this.labels,
            namespace: this.args.namespace,
            replicas: this.replicas,
            containers: [container],
            volumes: [
                { name: 'storage', emptyDir: {}},
                { name: 'config', configMap: { name: configmap.metadata.name } },
            ]
        }, { parent: this })
    }

    private getDefaultConfig() {
        return {
            global: {
                resolve_timeout: '5m'
            },
            route: {
                group_by: ['alertname'],
                group_wait: '10s',
                group_interval: '10s',
                repeat_interval: '1h',
                receiver: 'devnull',
                routes: []
            },
            receivers: [{ name: 'devnull' }],
            inhibit_rules: []
        }

    }
}
