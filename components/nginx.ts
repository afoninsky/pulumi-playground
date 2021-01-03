import * as pulumi from '@pulumi/pulumi'
import * as k8s from '@pulumi/kubernetes'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
}

export default class Nginx extends olly.ComponentResource implements pluggable.ScrapeTarget {

    readonly metrics: pluggable.ScrapeTargetItem[]

    private readonly args: Args

    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Ingress, name, args, opts)
        this.args = args

        const chart = this.createIngressController()

        // const svc = ing.getResource('v1/Service', 'default/ingress-controller')
        // this.externalIP = svc.status.loadBalancer.ingress[0].ip
        const svcMetrics = chart.getResource('v1/Service', 'default/ingress-controller-metrics')

        this.metrics = [{
            endpoint: svcMetrics.metadata.name,
            port: svcMetrics.spec.ports[0].name,
            namespace: svcMetrics.metadata.namespace,
        }]
    }

    createIngressController(): k8s.helm.v3.Chart {
        // https://github.com/kubernetes/ingress-nginx/blob/master/charts/ingress-nginx/values.yaml
        return new k8s.helm.v3.Chart(this.name, {
            chart: 'ingress-nginx',
            namespace: this.args.namespace,
            // version: '0.0.0',
            fetchOpts: {
                repo: 'https://kubernetes.github.io/ingress-nginx'
            },
            values: {
                fullnameOverride: this.name,
                controller: {
                    metrics: {
                        enabled: true,
                        // if this port is changed, change healthz-port: in extraArgs: accordingly
                        port: 10254
                    },
                    admissionWebhooks: {
                        enabled: false,
                    },
                }
            }
        }, { parent: this })
    }
}
