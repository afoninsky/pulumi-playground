import * as pulumi from '@pulumi/pulumi'
import * as k8s from '@pulumi/kubernetes'

export enum ComponentType {
    Example = 'example',
    Database = 'database',
    Notifier = 'notifier',
    Collector = 'collector',
    Dashboard = 'dashboard',
    Ingress = 'ingress',
}

export interface ComponentArgs {
    namespace: string
}

interface DeploymentArgs {
    name?: string
    namespace?: string
    labels: pulumi.Input<{[key: string]: pulumi.Input<string>}>
    labelSelector: pulumi.Input<{[key: string]: pulumi.Input<string>}>
    containers: k8s.types.input.core.v1.Container[]
    replicas?: number
    serviceAccountName?: pulumi.Input<string>
    volumes?: pulumi.Input<pulumi.Input<k8s.types.input.core.v1.Volume>[]>
}

interface ServiceAccountArgs {
    name?: string
    namespace?: string
    labels: pulumi.Input<{[key: string]: pulumi.Input<string>}>
}

export class ComponentResource extends pulumi.ComponentResource  {
    protected readonly type: ComponentType
    protected readonly name: string
    protected readonly labels: pulumi.Input<{[key: string]: pulumi.Input<string>}>

    constructor(type: ComponentType, name: string, args: ComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super(`olly:service:${type}`, name, {}, opts)
        this.type = type
        this.name = name
        this.labels = this.setLabels()
    }

    private setLabels(): pulumi.Input<{[key: string]: pulumi.Input<string>}> {
        return {
            'app.kubernetes.io/name': this.type,
            'app.kubernetes.io/instance': this.name,
            'app.kubernetes.io/component': this.type,
        }
    }

    protected serviceAccountTemplate(name: string, args: ServiceAccountArgs,  opts?: pulumi.ComponentResourceOptions): k8s.core.v1.ServiceAccount {
        return new k8s.core.v1.ServiceAccount(name, {
            metadata: { name, labels: args.labels, namespace: args.namespace },
            automountServiceAccountToken: false,
        }, opts)
    }

    protected statefulSetTeamplate(name: string, args: DeploymentArgs,  opts?: pulumi.ComponentResourceOptions): k8s.apps.v1.StatefulSet {

        if (args.serviceAccountName === undefined) {
            const sa = this.serviceAccountTemplate(name, args, opts)
            args.serviceAccountName = sa.metadata.name
        }
    
        const svcName = `${name}-headless`
    
        new k8s.core.v1.Service(svcName, {
            metadata: {
                name: svcName,
                labels: args.labels,
                namespace: args.namespace
            },
            spec: {
                clusterIP: 'None',
                selector: args.labels,
            },
        }, opts)
    
        return new k8s.apps.v1.StatefulSet(name, {
            metadata: {
                name: args.name,
                namespace: args.namespace,
                labels: args.labels
            },
            spec: {
                podManagementPolicy: 'Parallel' ,
                replicas: args.replicas || 1,
                selector: { matchLabels: args.labels },
                serviceName: svcName,
                updateStrategy: {
                    type: 'RollingUpdate',
                },
                template: {
                    metadata: {
                        labels: {...args.labels, ...args.labelSelector},
                        // annotations: {
                        //     'checksum/config': crypto.createHash('md5').update(cfg.configData).digest('hex'),
                        // }
                    },
                    spec: {
                        serviceAccountName: args.serviceAccountName,
                        containers: args.containers,
                        affinity: {
                            podAntiAffinity: {
                                preferredDuringSchedulingIgnoredDuringExecution: [{
                                    weight: 1,
                                    podAffinityTerm: {
                                        topologyKey: 'kubernetes.io/hostname',
                                        labelSelector: {
                                            matchLabels: args.labelSelector,
                                        }
                                    }
                                }]
                            }
                        },
                        volumes: args.volumes
                    },
                },
            },
        }, opts)
    }

    protected deploymentTemplate(name: string, args: DeploymentArgs,  opts?: pulumi.ComponentResourceOptions): k8s.apps.v1.Deployment {

        if (args.serviceAccountName === undefined) {
            const sa = this.serviceAccountTemplate(name, args, opts)
            args.serviceAccountName = sa.metadata.name
        }
    
        return new k8s.apps.v1.Deployment(name, {
            metadata: {
                name: args.name,
                namespace: args.namespace,
                labels: args.labels
            },
            spec: {
                replicas: args.replicas || 1,
                selector: { matchLabels: args.labelSelector },
                strategy: { type: 'RollingUpdate' },
                template: {
                    metadata: {
                        labels: {...args.labels, ...args.labelSelector},
                        // annotations: {
                        //     'checksum/config': crypto.createHash('md5').update(cfg.configData).digest('hex'),
                        // }
                    },
                    spec: {
                        serviceAccountName: args.serviceAccountName,
                        containers: args.containers,
                        affinity: {
                            podAntiAffinity: {
                                preferredDuringSchedulingIgnoredDuringExecution: [{
                                    weight: 1,
                                    podAffinityTerm: {
                                        topologyKey: 'kubernetes.io/hostname',
                                        labelSelector: {
                                            matchLabels: args.labelSelector,
                                        }
                                    }
                                }]
                            }
                        },
                        volumes: args.volumes
                    },
                },
            },
        }, opts)
    }
}