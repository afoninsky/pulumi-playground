import * as pulumi from '@pulumi/pulumi'
import * as k8s from '@pulumi/kubernetes'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
    notifiers: pluggable.Notifier[]
    storage: pluggable.Prometheus
    alerts: any[] // TODO
}

export default class VMAlert extends olly.ComponentResource implements pluggable.ScrapeTarget {

    readonly metrics: pluggable.ScrapeTargetItem[]

    private readonly args: Args

    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Notifier, name, args, opts)
        this.args = args

        const configmap = this.createConfigMap()
        const deployment = this.createDeployment(configmap)
        const service = this.createService(deployment)

        this.metrics = [{
            endpoint: service.metadata.name,
            port: service.spec.ports[0].name,
            namespace: service.metadata.namespace,
        }]
    }

    private createConfigMap(): k8s.core.v1.ConfigMap {

        return new k8s.core.v1.ConfigMap(this.name, {
            metadata: {
                name: this.name,
                namespace: this.args.namespace,
                labels: this.labels
            },
            data: {
                'alerts.yaml': '',
            }
        }, { parent: this })
    }

    private createDeployment(configmap: k8s.core.v1.ConfigMap): k8s.apps.v1.Deployment {

        const extraArgs: pulumi.Input<pulumi.Input<string>[]> = []
        
        // send notifications to all provided notifiers at the same time
        for (const svc of this.args.notifiers) {
            for (const url of svc.notificationURLs){
                extraArgs.push(pulumi.interpolate `-notifier.url=${url}`) 
            }
        }
        const { prometheus } = this.args.storage

        const container: k8s.types.input.core.v1.Container = {
            name: 'vmalert',
            image: `victoriametrics/vmalert:${this.args.tag}`,
            args: [
                ...extraArgs,
                pulumi.interpolate `-datasource.url=${prometheus.remoteReadURL}`,
                pulumi.interpolate `-remoteRead.url=${prometheus.remoteReadURL}}`,
                pulumi.interpolate `-remoteWrite.url=${prometheus.remoteWriteURL}`,
                '-rule="/etc/vmalert/*.yaml',
                '-rule.validateExpressions=true',
                '-rule.validateTemplates=true',
                '-loggerFormat=json',
                // `-loggerLevel=${cfg.logLevel.toUpperCase()}`,
            ],
            ports: [
                { name: 'http', containerPort: 8880 },
            ],
            readinessProbe: {
                httpGet: {
                    port: 'http',
                    path: '/health',
                },
            },
            livenessProbe: {
                tcpSocket: {
                    port: 'http',
                },
            },
            volumeMounts: [
                {
                    name: 'config',
                    mountPath: '/etc/vmalert/alerts.yaml',
                    subPath: 'alerts.yaml',
                    readOnly: true,
                }
            ]
        }
        
        return this.deploymentTemplate(this.name, {
            name: this.name,
            labels: this.labels,
            labelSelector: this.labels,
            namespace: this.args.namespace,
            replicas: 1,
            containers: [container],
            volumes: [
                { name: 'config', configMap: { name: configmap.metadata.name } },
            ]
        }, { parent: this })
    }

    private createService(deployment: k8s.apps.v1.Deployment): k8s.core.v1.Service {
        
        return new k8s.core.v1.Service(this.name, {
            metadata: {
                name: this.name,
                labels: this.labels,
                namespace: this.args.namespace
            },
            spec: {
                ports: [
                    { name: 'http', port: 8880, targetPort: 'http' },
                ],
                selector: deployment.spec.selector.matchLabels,
            },
        }, { parent: this })
    }
}
