// TODO
import * as pulumi from '@pulumi/pulumi'

import * as olly from '../src'
import * as pluggable from '../src/pluggable'

interface Args extends olly.ComponentArgs {
    tag: string
    storage: any
    targets: any[]
}

export default class VMAgent extends olly.ComponentResource implements pluggable.ScrapeTarget {

    readonly metrics: pluggable.ScrapeTargetItem[]

    private readonly args: Args

    constructor(name: string, args: Args, opts?: pulumi.ComponentResourceOptions) {
        super(olly.ComponentType.Collector, name, args, opts)
        this.args = args

        const { name: svcName, namespace: svcNamespace } = service.metadata
        const svcPort = service.spec.ports[0].port

        this.metrics = [{
            endpoint: svcName,
            port: service.spec.ports[0].name,
            namespace: svcNamespace,
        }]
    }
}
