import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'

const image = 'prom/alertmanager'

export interface ServiceArgs {
    // image: string;
    // resources?: k8stypes.core.v1.ResourceRequirements;
    replicas?: number
    tag?: string
    // ports?: number[];
    // allocateIpAddress?: boolean;
    // isMinikube?: boolean;
}

export class Service extends pulumi.ComponentResource {

    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly service: k8s.core.v1.Service;

    constructor(name: string, args: ServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super('olly:service:Alertmanager', name, {}, opts)

        const labels = { app: name }

        const container: k8s.types.input.core.v1.Container = {
            name,
            image: `${image}:${args.tag || 'latest'}`,
            // env: [{ name: 'GET_HOSTS_FROM', value: 'dns' }],
            ports: [
                { name: 'http', containerPort: 9093 },
                { name: 'cluster', containerPort: 9094 },
            ],
        }

        this.deployment = new k8s.apps.v1.Deployment(name, {
            spec: {
                selector: { matchLabels: labels },
                replicas: args.replicas || 1,
                template: {
                    metadata: { labels: labels },
                    spec: { containers: [ container ] },
                },
            },
        }, { parent: this })

        this.service = new k8s.core.v1.Service(name, {
            metadata: {
                name: name,
                labels: this.deployment.metadata.labels,
            },
            spec: {
                ports: [
                    { name: 'http', port: 9093, targetPort: 9093 },
                    { name: 'cluster', port: 9094, targetPort: 9094 }
                ],
                selector: this.deployment.spec.template.metadata.labels,
            },
        }, { parent: this })
    }
}