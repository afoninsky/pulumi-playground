import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
}

export default class VictoriaMetrics extends olly.ComponentResource implements pluggable.GrafanaDS, pluggable.Prometheus, pluggable.ScrapeTarget {

    readonly prometheus: pluggable.PrometheusItem
    readonly datasource: pluggable.GrafanaDSItem
    readonly metrics: pluggable.ScrapeTargetItem[]

    private readonly args: Args

    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Database, name, args, opts)    
        this.args = args

        // create set of k8s manifests
        const ss = this.createSatefulSet()
        const service = this.createService(ss)

        const { name: svcName, namespace: svcNamespace } = service.metadata
        const svcPort = service.spec.ports[0].port
        const remoteReadURL = pulumi.interpolate `http://${svcName}.${svcNamespace}:${svcPort}`

        // satisfy pluggable requiremens
        this.prometheus = {
            remoteReadURL,
            remoteWriteURL: pulumi.interpolate `http://${svcName}.${svcNamespace}:${svcPort}`,
        }

        this.datasource = {
            name: this.name,
            type: 'prometheus',
            URL: remoteReadURL,
        }

        // TODO: get service
        this.metrics = []
    }

    private createSatefulSet(): k8s.apps.v1.StatefulSet {

        const container: k8s.types.input.core.v1.Container = {
            name: 'victoria',
            image: `victoriametrics/victoria-metrics:${this.args.tag}`,
            ports: [ { name: 'http', containerPort: 8428 } ],
            args: [
                '--retentionPeriod=12',
                '-loggerFormat=json',
                // '-loggerLevel=WARN',
                '--storageDataPath=/victoria-metrics-data',
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
                { name: 'storage', mountPath: '/victoria-metrics-data' },
            ]
        }
        
        return this.statefulSetTeamplate(this.name, {
            name: this.name,
            labels: this.labels,
            labelSelector: this.labels,
            namespace: this.args.namespace,
            replicas: 1,
            containers: [container],
            volumes: [
                { name: 'storage', emptyDir: {}},
            ]
        }, { parent: this })
    }

    private createService(ss: k8s.apps.v1.StatefulSet): k8s.core.v1.Service {
        
        return new k8s.core.v1.Service(this.name, {
            metadata: {
                name: this.name,
                labels: this.labels,
                namespace: this.args.namespace
            },
            spec: {
                ports: [{ name: 'http', port: 8428, targetPort: 'http' }],
                selector: ss.spec.selector.matchLabels,
            },
        }, { parent: this })
    }
}