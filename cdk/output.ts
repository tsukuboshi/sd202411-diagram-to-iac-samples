import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";

export class AlbEc2RdsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "MyVPC", {
      maxAzs: 2,
      cidr: "10.0.0.0/16",
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: "Database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Security Groups
    const albSg = new ec2.SecurityGroup(this, "ALBSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Security group for ALB",
    });

    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP traffic"
    );
    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS traffic"
    );

    const ec2Sg = new ec2.SecurityGroup(this, "EC2SecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Security group for EC2 instances",
    });

    ec2Sg.addIngressRule(
      albSg,
      ec2.Port.tcp(80),
      "Allow HTTP traffic from ALB"
    );

    const dbSg = new ec2.SecurityGroup(this, "DBSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Security group for RDS",
    });

    dbSg.addIngressRule(
      ec2Sg,
      ec2.Port.tcp(3306),
      "Allow MySQL traffic from EC2"
    );

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, "MyALB", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const listener = alb.addListener("MyListener", {
      port: 80,
      open: true,
    });

    // EC2 Instances
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "yum update -y",
      "yum install -y httpd",
      "systemctl start httpd",
      "systemctl enable httpd"
    );

    const instanceType = ec2.InstanceType.of(
      ec2.InstanceClass.T2,
      ec2.InstanceSize.MICRO
    );
    const machineImage = ec2.MachineImage.latestAmazonLinux2();

    const ec2Instance1 = new ec2.Instance(this, "EC2Instance1", {
      vpc,
      instanceType,
      machineImage,
      userData,
      securityGroup: ec2Sg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const ec2Instance2 = new ec2.Instance(this, "EC2Instance2", {
      vpc,
      instanceType,
      machineImage,
      userData,
      securityGroup: ec2Sg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "MyTargetGroup",
      {
        vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [ec2Instance1, ec2Instance2],
        healthCheck: {
          path: "/",
          unhealthyThresholdCount: 2,
          healthyThresholdCount: 5,
          interval: cdk.Duration.seconds(30),
        },
      }
    );

    listener.addTargetGroups("MyTargetGroup", {
      targetGroups: [targetGroup],
    });

    // RDS Instance
    const dbInstance = new rds.DatabaseInstance(this, "MyRDSInstance", {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_5_7,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: "mydb",
      allocatedStorage: 20,
      maxAllocatedStorage: 1000,
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // Outputs
    new cdk.CfnOutput(this, "VPCId", {
      value: vpc.vpcId,
      description: "VPC ID",
      exportName: "VPCId",
    });

    new cdk.CfnOutput(this, "ALBDNSName", {
      value: alb.loadBalancerDnsName,
      description: "ALB DNS Name",
      exportName: "ALBDNSName",
    });

    new cdk.CfnOutput(this, "EC2Instance1Id", {
      value: ec2Instance1.instanceId,
      description: "EC2 Instance 1 ID",
      exportName: "EC2Instance1Id",
    });

    new cdk.CfnOutput(this, "EC2Instance2Id", {
      value: ec2Instance2.instanceId,
      description: "EC2 Instance 2 ID",
      exportName: "EC2Instance2Id",
    });

    new cdk.CfnOutput(this, "RDSEndpoint", {
      value: dbInstance.dbInstanceEndpointAddress,
      description: "RDS Endpoint",
      exportName: "RDSEndpoint",
    });
  }
}

// Add this to your main CDK app file (e.g., bin/my-cdk-app.ts)
const app = new cdk.App();
new AlbEc2RdsStack(app, "AlbEc2RdsStack");
app.synth();
